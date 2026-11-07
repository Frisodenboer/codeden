import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import type { FileContent, FileReadQuery, FileRoot, FileWriteRequest } from "@codeden/contracts";
import { badRequest, conflict, forbidden, ServiceError } from "../errors";
import type { ProjectService } from "../projects/project-service";
import { resolveInside } from "./path-guard";

const MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * Files that hold credentials. They are never readable or writable through the API, even
 * though they live inside an allowed root (§15).
 */
const BLOCKED: Record<FileRoot, string[]> = {
  claude: [".credentials.json"],
  codex: ["auth.json"],
  project: [],
};

export interface ConfigFilesDeps {
  projects: ProjectService;
  /** User home (tests point it at a temp folder). */
  home?: string;
  /** `<codeden home>/backups/files`: copies taken before overwriting. */
  backupDir: string;
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/**
 * Read and write provider config files for the editors (§12.4): restricted to a project's
 * checkout, `~/.claude` and `~/.codex`, through the path guard. Writes are atomic, keep a
 * backup, and support optimistic concurrency via the sha256 the editor loaded.
 */
export class ConfigFiles {
  constructor(private readonly deps: ConfigFilesDeps) {}

  read(q: FileReadQuery): FileContent {
    const { absolutePath, relativePath } = this.locate(q.root, q.projectId, q.path);
    if (!existsSync(absolutePath)) {
      return {
        root: q.root,
        path: relativePath,
        absolutePath,
        exists: false,
        content: "",
        sha256: null,
        sizeBytes: 0,
      };
    }
    const stat = statSync(absolutePath);
    if (!stat.isFile()) throw badRequest("Not a file", "not_a_file");
    if (stat.size > MAX_READ_BYTES)
      throw new ServiceError(413, "file_too_large", "File is larger than 2 MB");
    const bytes = readFileSync(absolutePath);
    if (bytes.subarray(0, 8000).includes(0))
      throw new ServiceError(415, "binary_file", "Binary files cannot be edited");
    return {
      root: q.root,
      path: relativePath,
      absolutePath,
      exists: true,
      content: bytes.toString("utf8"),
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
    };
  }

  write(req: FileWriteRequest): FileContent {
    const { absolutePath, relativePath } = this.locate(req.root, req.projectId, req.path);
    if (relativePath.split(/[\\/]/).includes(".git")) {
      throw forbidden("Files inside .git cannot be edited", "path_blocked");
    }
    const exists = existsSync(absolutePath);
    if (req.expectedSha256 !== undefined) {
      const current = exists ? sha256(readFileSync(absolutePath)) : null;
      if (current !== req.expectedSha256) {
        throw conflict("The file changed since it was loaded", "file_changed");
      }
    }
    if (exists) {
      mkdirSync(this.deps.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      copyFileSync(
        absolutePath,
        join(this.deps.backupDir, `${stamp}-${req.root}-${basename(absolutePath)}`),
      );
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    const tmp = `${absolutePath}.codeden-${process.pid}.tmp`;
    writeFileSync(tmp, req.content, "utf8");
    renameSync(tmp, absolutePath);
    return this.read({ root: req.root, projectId: req.projectId, path: relativePath });
  }

  private rootDir(root: FileRoot, projectId: string | undefined): string {
    const home = this.deps.home ?? homedir();
    if (root === "claude") return join(home, ".claude");
    if (root === "codex") return join(home, ".codex");
    if (!projectId) throw badRequest("projectId is required for project files", "project_required");
    return this.deps.projects.get(projectId).path;
  }

  private locate(root: FileRoot, projectId: string | undefined, path: string) {
    const dir = this.rootDir(root, projectId);
    const absolutePath = resolveInside(dir, path);
    const relativePath = relative(dir, absolutePath).split(sep).join("/");
    if (!relativePath) throw badRequest("A file path is required", "not_a_file");
    const lower = relativePath.toLowerCase();
    if (BLOCKED[root].some((b) => lower === b.toLowerCase())) {
      throw forbidden("This file holds credentials and cannot be opened", "path_blocked");
    }
    return { absolutePath, relativePath };
  }
}
