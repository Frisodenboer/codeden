import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Context for path checks: the worktree plus any extra directories the agent may use. */
export interface PathContext {
  /** The session's working directory (worktree). */
  cwd: string;
  /**
   * The directory relative paths resolve against: the shell's current directory, or where a
   * `cd` earlier in the command moved. Defaults to `cwd`. Never widens the worktree.
   */
  dir?: string;
  /** Extra writable roots (SessionOptions.additionalDirectories). */
  extraRoots?: readonly string[];
  /** The OS temp directories. Defaults to `osTempRoots()` for the running platform. */
  tempRoots?: readonly string[];
  /** Defaults to `process.platform`; set in tests to exercise both path flavours. */
  platform?: NodeJS.Platform;
  /** Home directory used to expand `~`. Defaults to `process.env.HOME ?? USERPROFILE`. */
  home?: string;
}

const isWin = (ctx: PathContext) => (ctx.platform ?? process.platform) === "win32";

function pathApi(ctx: PathContext): path.PlatformPath {
  return isWin(ctx) ? path.win32 : path.posix;
}

function homeOf(ctx: PathContext): string {
  return ctx.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function tempRootsOf(ctx: PathContext): readonly string[] {
  return ctx.tempRoots ?? osTempRoots(ctx.platform);
}

const HOME_VARS = /^(\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=$|[\\/])/i;
const TEMP_VARS =
  /^(\$TMPDIR|\$\{TMPDIR\}|\$TEMP|\$TMP|\$env:TEMP|\$env:TMP|%TEMP%|%TMP%)(?=$|[\\/])/i;

/**
 * Git Bash paths on Windows: `/c/Users/x` is `C:\Users\x`, and `/tmp` is the user's temp
 * directory.
 */
function fromGitBash(value: string, temp: string | undefined): string {
  if (temp && /^\/tmp(?=$|\/)/.test(value)) return temp + value.slice(4);
  const drive = /^\/([a-z])(?=$|\/)/i.exec(value);
  if (drive?.[1]) return `${drive[1].toUpperCase()}:\\${value.slice(3)}`;
  return value;
}

/**
 * Resolve `target` (absolute, relative to `dir`, `~`-prefixed, or starting with a home or
 * temp variable) to an absolute path.
 */
export function resolveAgainst(target: string, ctx: PathContext): string {
  const p = pathApi(ctx);
  let value = target.trim().replace(/^["']|["']$/g, "");
  const home = homeOf(ctx);
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    value = home + value.slice(1);
  }
  value = value.replace(HOME_VARS, home);
  const temp = tempRootsOf(ctx)[0];
  if (temp) value = value.replace(TEMP_VARS, temp);
  if (isWin(ctx)) value = fromGitBash(value, temp);
  return p.resolve(ctx.dir ?? ctx.cwd, value);
}

/** True when `target` resolves inside `root` (or equals it). Case-insensitive on Windows. */
export function isInside(target: string, root: string, ctx: PathContext): boolean {
  const rel = relative(root, target, ctx);
  return rel === "" || (!rel.startsWith("..") && !pathApi(ctx).isAbsolute(rel));
}

function relative(root: string, target: string, ctx: PathContext): string {
  const p = pathApi(ctx);
  const norm = (s: string) => (isWin(ctx) ? p.resolve(s).toLowerCase() : p.resolve(s));
  return p.relative(norm(root), norm(target));
}

/** True when `target` is inside the worktree or one of the extra roots. */
export function isInWorkspace(target: string, ctx: PathContext): boolean {
  const abs = resolveAgainst(target, ctx);
  return [ctx.cwd, ...(ctx.extraRoots ?? [])].some((root) => isInside(abs, root, ctx));
}

/** True when `target` is strictly inside one of the OS temp directories (never the root). */
export function isInTemp(target: string, ctx: PathContext): boolean {
  const abs = resolveAgainst(target, ctx);
  return tempRootsOf(ctx).some((root) => {
    const rel = relative(root, abs, ctx);
    return rel !== "" && isInside(abs, root, ctx);
  });
}

/** True when agents may write `target` without asking: the worktree, extra roots or temp. */
export function isWritable(target: string, ctx: PathContext): boolean {
  return isInWorkspace(target, ctx) || isInTemp(target, ctx);
}

/**
 * Usable temp roots from `candidates`: absolute, deduplicated, and never a filesystem root,
 * the home directory or one of its parents (a stray `TMPDIR=/` must not open everything).
 */
export function tempRootsFrom(
  candidates: ReadonlyArray<string | undefined>,
  platform: NodeJS.Platform,
  home: string,
): string[] {
  const ctx: PathContext = { cwd: "/", platform };
  const p = pathApi(ctx);
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || !p.isAbsolute(candidate)) continue;
    const root = p.resolve(candidate);
    if (p.parse(root).root === root || p.dirname(root) === root) continue;
    if (home && isInside(home, root, ctx)) continue;
    if (!out.some((r) => relative(r, root, ctx) === "")) out.push(root);
  }
  return out;
}

const realpath = (p: string): string | undefined => {
  try {
    return realpathSync.native(p);
  } catch {
    return undefined;
  }
};

let cachedTempRoots: string[] | undefined;

/**
 * The OS temp directories for the running platform: `os.tmpdir()`, `%TEMP%` and `%TMP%` on
 * Windows, `$TMPDIR` and `/tmp` elsewhere, each also by its real path (macOS symlinks
 * `/tmp`, Windows may report a short 8.3 name). Empty when asked about another platform.
 */
export function osTempRoots(platform: NodeJS.Platform = process.platform): readonly string[] {
  if (platform !== process.platform) return [];
  if (cachedTempRoots) return cachedTempRoots;
  const env = process.env;
  const base = [
    os.tmpdir(),
    ...(platform === "win32" ? [env.TEMP, env.TMP] : [env.TMPDIR, "/tmp"]),
  ];
  const candidates = base.flatMap((c) => (c ? [c, realpath(c)] : []));
  cachedTempRoots = tempRootsFrom(candidates, platform, os.homedir());
  return cachedTempRoots;
}

const SECRET_BASENAMES = new Set([
  ".env",
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".git-credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "service-account.json",
]);
const SAFE_ENV_SUFFIXES = [".example", ".sample", ".template", ".dist", ".defaults"];
const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];

/** True for files that commonly hold credentials (`.env`, SSH keys, `.npmrc`, `*.pem`, ...). */
export function isSecretPath(target: string): boolean {
  const normalized = target
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/");
  const base = normalized.split("/").pop()?.toLowerCase() ?? "";
  if (!base) return false;
  if (base === ".env" || base.startsWith(".env.")) {
    return !SAFE_ENV_SUFFIXES.some((s) => base.endsWith(s));
  }
  if (base.endsWith(".env") && base !== ".env") return !base.includes("example");
  if (SECRET_BASENAMES.has(base)) return true;
  if (SECRET_EXTENSIONS.some((ext) => base.endsWith(ext))) return true;
  return /(^|\/)\.(ssh|aws|gnupg|docker)\//i.test(normalized) && !base.endsWith(".pub");
}
