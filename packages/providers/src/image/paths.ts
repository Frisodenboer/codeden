import path from "node:path";

/** Where generated images go: an absolute directory plus a file stem (no extension). */
export interface ImageOutputTarget {
  outputDir: string;
  fileStem: string;
}

export interface ResolveImageOutputOptions {
  /** Defaults to `process.platform`; decides path semantics and case sensitivity. */
  platform?: NodeJS.Platform;
  /** Directory (relative to the worktree) used when no path is given. */
  defaultDir?: string;
  /** Stem used when the path names a directory. */
  defaultStem?: string;
}

export const DEFAULT_IMAGE_DIR = "generated-images";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Resolve a requested output path (relative to the worktree, or absolute inside it) into a
 * directory and file stem. Pure: it never touches the disk, so callers should pass the
 * worktree's real path. Throws `Error` for paths that escape the worktree, point into `.git`,
 * or contain NUL bytes.
 *
 * - `undefined` / `""`        -> `<root>/generated-images`, stem `image`
 * - `public/hero.png`        -> `<root>/public`, stem `hero` (the extension follows the bytes)
 * - `assets/img/` or `assets` -> `<root>/assets/img` / `<root>/assets`, default stem
 */
export function resolveImageOutput(
  worktreeRoot: string,
  outputPath: string | undefined,
  opts: ResolveImageOutputOptions = {},
): ImageOutputTarget {
  const platform = opts.platform ?? process.platform;
  const p = platform === "win32" ? path.win32 : path.posix;
  if (!p.isAbsolute(worktreeRoot)) throw new Error("The worktree root must be an absolute path");
  const requested = (outputPath ?? "").trim() || (opts.defaultDir ?? DEFAULT_IMAGE_DIR);
  if (requested.includes("\0")) throw new Error("The output path contains a NUL byte");
  const root = p.resolve(worktreeRoot);
  const target = p.resolve(root, requested);
  const rel = p.relative(root, target);
  if (rel.startsWith("..") || p.isAbsolute(rel)) {
    throw new Error(`The output path must stay inside the worktree: ${requested}`);
  }
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  if (segments.some((s) => s.toLowerCase() === ".git")) {
    throw new Error("The output path must not point into .git");
  }
  const endsWithSeparator = /[\\/]$/.test(requested);
  const ext = p.extname(target).toLowerCase();
  const namesFile = !endsWithSeparator && IMAGE_EXTENSIONS.has(ext) && segments.length > 0;
  if (!namesFile) {
    return { outputDir: target, fileStem: sanitizeFileStem(opts.defaultStem ?? "image") };
  }
  return {
    outputDir: p.dirname(target),
    fileStem: sanitizeFileStem(p.basename(target, p.extname(target))),
  };
}

/** A file stem that is safe on every platform: no separators, reserved names or odd endings. */
export function sanitizeFileStem(stem: string): string {
  let clean = Array.from(stem, (ch) =>
    ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? "-" : ch,
  )
    .join("")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 80)
    .replace(/[\s.]+$/g, "");
  if (!clean) clean = "image";
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
  return clean;
}

/** `hero.png`, `hero-2.png`, `hero-3.jpg`, ... one per extension, in order. */
export function imageFileNames(stem: string, extensions: readonly string[]): string[] {
  const base = sanitizeFileStem(stem);
  return extensions.map((ext, i) => `${base}${i === 0 ? "" : `-${i + 1}`}${ext}`);
}
