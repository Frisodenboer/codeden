import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  AgentConfigDeleteResponse,
  AgentConfigDiff,
  AgentConfigFileContent,
  AgentConfigLocator,
  AgentConfigWriteResponse,
} from "@codeden/contracts";
import { structuredPatch } from "diff";
import { badRequest, conflict, forbidden, ServiceError } from "../errors";
import { resolveInside } from "../files/path-guard";
import { toRelative } from "./paths";

const MAX_READ_BYTES = 2 * 1024 * 1024;

/** Agent-config locations per root (case-insensitive, `/`-separated relative paths). */
const ALLOWED: Record<AgentConfigLocator["root"], RegExp[]> = {
  home: [
    /^\.claude\/CLAUDE\.md$/i,
    /^\.claude\/rules\/.+\.md$/i,
    /^\.claude\/skills\/[^/.][^/]*\/.+$/i,
    /^\.claude\/agents\/.+\.md$/i,
    /^\.codex\/AGENTS(\.override)?\.md$/i,
    /^\.codex\/skills\/[^/.][^/]*\/.+$/i,
    /^\.agents\/skills\/[^/.][^/]*\/.+$/i,
    /^\.codex\/agents\/[^/]+\.toml$/i,
  ],
  project: [
    /^(.+\/)?CLAUDE(\.local)?\.md$/i,
    /^\.claude\/CLAUDE\.md$/i,
    /^\.claude\/rules\/.+\.md$/i,
    /^\.claude\/skills\/[^/.][^/]*\/.+$/i,
    /^\.claude\/agents\/.+\.md$/i,
    /^(.+\/)?AGENTS(\.override)?\.md$/i,
    /^\.agents\/skills\/[^/.][^/]*\/.+$/i,
    /^\.codex\/agents\/[^/]+\.toml$/i,
  ],
  auto_memory: [/^.+\.md$/i],
};

/** A skill folder: `<skills root>/<name>` (deleted as a whole). */
const SKILL_FOLDER = /^(\.claude|\.codex|\.agents)\/skills\/[^/.][^/]*$/i;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export interface ResolvedLocation {
  locator: AgentConfigLocator;
  absolutePath: string;
  relativePath: string;
}

/**
 * Read, write, create and delete agent-config files (§12.4) in their native locations.
 * Paths are validated against the known locations of each provider and kept inside their
 * root (symlinks included). Every overwrite or delete is backed up first; writes are atomic.
 */
export class AgentConfigFiles {
  constructor(
    private readonly rootDir: (locator: AgentConfigLocator) => string,
    private readonly backupDir: string,
  ) {}

  /** Validate a locator and resolve it to an absolute path. */
  resolve(locator: AgentConfigLocator, opts: { folder?: boolean } = {}): ResolvedLocation {
    const dir = this.rootDir(locator);
    const absolutePath = resolveInside(dir, locator.path);
    const relativePath = toRelative(dir, absolutePath);
    const segments = relativePath.split("/");
    if (!relativePath || segments.includes("..") || segments.includes(".git")) {
      throw forbidden("Not an agent configuration file", "path_not_allowed");
    }
    const ok = opts.folder
      ? locator.root !== "auto_memory" && SKILL_FOLDER.test(relativePath)
      : ALLOWED[locator.root].some((re) => re.test(relativePath));
    if (!ok)
      throw forbidden(`Not an agent configuration file: ${relativePath}`, "path_not_allowed");
    return { locator: { ...locator, path: relativePath }, absolutePath, relativePath };
  }

  read(locator: AgentConfigLocator): AgentConfigFileContent {
    const loc = this.resolve(locator);
    return this.readResolved(loc);
  }

  /** Create or overwrite; `create: true` refuses an existing file. */
  write(
    locator: AgentConfigLocator,
    content: string,
    opts: { expectedSha256?: string | null; create?: boolean } = {},
  ): AgentConfigWriteResponse {
    const loc = this.resolve(locator);
    const exists = existsSync(loc.absolutePath);
    if (opts.create && exists) throw conflict("The file already exists", "file_exists");
    if (opts.expectedSha256 !== undefined) {
      const current = exists ? sha256(readFileSync(loc.absolutePath)) : null;
      if (current !== opts.expectedSha256) {
        throw conflict("The file changed since it was loaded", "file_changed");
      }
    }
    const backupPath = exists ? this.backup(loc.absolutePath) : null;
    atomicWrite(loc.absolutePath, content);
    return { file: this.readResolved(loc), backupPath };
  }

  /** Delete a file, or a whole skill folder with `folder: true`, after backing it up. */
  delete(locator: AgentConfigLocator, opts: { folder?: boolean } = {}): AgentConfigDeleteResponse {
    const loc = this.resolve(locator, opts);
    if (!existsSync(loc.absolutePath)) return { deleted: false, backupPath: null };
    const isDir = statSync(loc.absolutePath).isDirectory();
    if (isDir !== Boolean(opts.folder)) {
      throw badRequest(isDir ? "Pass folder=1 to delete a folder" : "Not a folder", "wrong_type");
    }
    const backupPath = this.backup(loc.absolutePath);
    rmSync(loc.absolutePath, { recursive: isDir, force: true });
    return { deleted: true, backupPath };
  }

  /** Unified diff of writing `content` over the current file. */
  diff(locator: AgentConfigLocator, content: string): AgentConfigDiff {
    const loc = this.resolve(locator);
    const current = this.readResolved(loc);
    return unifiedDiff(loc.absolutePath, current.exists, current.content, content);
  }

  /** Copy a file or folder into the backup folder; returns the copy's path. */
  backup(path: string): string {
    mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(this.backupDir, `${stamp}-${basename(path)}`);
    cpSync(path, target, { recursive: true });
    return target;
  }

  private readResolved(loc: ResolvedLocation): AgentConfigFileContent {
    const base = { ...loc.locator, absolutePath: loc.absolutePath };
    if (!existsSync(loc.absolutePath)) return { ...base, exists: false, content: "", sha256: null };
    const stat = statSync(loc.absolutePath);
    if (!stat.isFile()) throw badRequest("Not a file", "not_a_file");
    if (stat.size > MAX_READ_BYTES) {
      throw new ServiceError(413, "file_too_large", "File is larger than 2 MB");
    }
    const bytes = readFileSync(loc.absolutePath);
    return { ...base, exists: true, content: bytes.toString("utf8"), sha256: sha256(bytes) };
  }
}

/** Write through a temp file and rename, creating parent folders. */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.codeden-${process.pid}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** A unified diff (`diff` package) with addition and deletion counts. */
export function unifiedDiff(
  path: string,
  exists: boolean,
  before: string,
  after: string,
): AgentConfigDiff {
  const name = basename(path);
  const structured = structuredPatch(
    exists ? `a/${name}` : "/dev/null",
    `b/${name}`,
    before,
    after,
    undefined,
    undefined,
    { context: 3 },
  );
  let additions = 0;
  let deletions = 0;
  const lines = [`--- ${structured.oldFileName}`, `+++ ${structured.newFileName}`];
  for (const hunk of structured.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
      lines.push(line);
    }
  }
  const changed = structured.hunks.length > 0;
  return {
    absolutePath: path,
    exists,
    patch: changed ? `${lines.join("\n")}\n` : "",
    additions,
    deletions,
    changed,
  };
}
