import path from "node:path";

/** Context for path checks: the worktree plus any extra directories the agent may use. */
export interface PathContext {
  /** The session's working directory (worktree). */
  cwd: string;
  /** Extra writable roots (SessionOptions.additionalDirectories). */
  extraRoots?: readonly string[];
  /** Defaults to `process.platform`; set in tests to exercise both path flavours. */
  platform?: NodeJS.Platform;
  /** Home directory used to expand `~`. Defaults to `process.env.HOME ?? USERPROFILE`. */
  home?: string;
}

function pathApi(ctx: PathContext): path.PlatformPath {
  return (ctx.platform ?? process.platform) === "win32" ? path.win32 : path.posix;
}

/** Resolve `target` (absolute, relative to cwd, or `~`-prefixed) to an absolute path. */
export function resolveAgainst(target: string, ctx: PathContext): string {
  const p = pathApi(ctx);
  let value = target.trim().replace(/^["']|["']$/g, "");
  const home = ctx.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    value = home + value.slice(1);
  }
  value = value.replace(/^\$HOME(?=$|[\\/])/, home).replace(/^\$env:USERPROFILE(?=$|[\\/])/i, home);
  return p.resolve(ctx.cwd, value);
}

/** True when `target` resolves inside `root` (or equals it). Case-insensitive on Windows. */
export function isInside(target: string, root: string, ctx: PathContext): boolean {
  const p = pathApi(ctx);
  const win = (ctx.platform ?? process.platform) === "win32";
  const norm = (s: string) => {
    const r = p.resolve(s);
    return win ? r.toLowerCase() : r;
  };
  const rel = p.relative(norm(root), norm(target));
  return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
}

/** True when `target` is inside the worktree or one of the extra roots. */
export function isInWorkspace(target: string, ctx: PathContext): boolean {
  const abs = resolveAgainst(target, ctx);
  return [ctx.cwd, ...(ctx.extraRoots ?? [])].some((root) => isInside(abs, root, ctx));
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
