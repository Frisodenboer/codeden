import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { BrokenExecutable } from "@codeden/contracts";

/**
 * The file an npm/pnpm/yarn shim launches: the last `%dp0%\...` path of a `.cmd`/`.bat` shim
 * (`"%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*`) or the last `$basedir/...`
 * path of a `.ps1` shim. Any extension counts (packages may ship a native binary), but not
 * `node.exe`, which shims mention before their target. `undefined` when none is found.
 */
export function shimTarget(shimPath: string, content: string): string | undefined {
  const ext = path.win32.extname(shimPath).toLowerCase();
  const re = ext === ".ps1" ? /"\$basedir[\\/]([^"$]+)"/gi : /"%~?dp0%?\\?([^"%]+\.[a-z0-9]+)"/gi;
  let last: string | undefined;
  for (const match of content.matchAll(re)) {
    const rel = match[1] ?? "";
    if (/^node(\.exe)?$/i.test(path.win32.basename(rel))) continue;
    last = rel;
  }
  if (!last) return undefined;
  return path.win32.resolve(path.win32.dirname(shimPath), last.replace(/\//g, "\\"));
}

/** What a file found while looking for a tool turned out to be. */
export type Inspection =
  /** Not there (or a directory): keep looking. */
  | { kind: "absent" }
  /** Present but cannot run. */
  | { kind: "broken"; broken: BrokenExecutable }
  /** Looks runnable; `target` is the file a shim launches, when known. */
  | { kind: "candidate"; target?: string }
  /** Present and fine, but not something CodeDen runs (a PowerShell shim): skip it. */
  | { kind: "skip" };

const SHIM_EXTS = new Set([".cmd", ".bat", ".ps1"]);

/**
 * Check a file without running it: a link to a missing file, an empty file, or a shim whose
 * package was removed is broken. Never throws.
 */
export function inspectFile(file: string, win: boolean): Inspection {
  let link: ReturnType<typeof lstatSync>;
  try {
    link = lstatSync(file);
  } catch {
    return { kind: "absent" };
  }
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return { kind: "absent" };
    size = stat.size;
  } catch {
    if (!link.isSymbolicLink()) return { kind: "absent" };
    let target: string | undefined;
    try {
      target = path.resolve(path.dirname(file), readlinkSync(file));
    } catch {
      target = undefined;
    }
    return {
      kind: "broken",
      broken: { path: file, reason: "points at a missing file", ...(target ? { target } : {}) },
    };
  }
  if (size === 0) return { kind: "broken", broken: { path: file, reason: "is empty" } };
  if (!win) {
    try {
      accessSync(file, constants.X_OK);
    } catch {
      return { kind: "absent" }; // not executable: not a command
    }
  }
  const ext = path.extname(file).toLowerCase();
  if (!win || !SHIM_EXTS.has(ext)) return { kind: "candidate" };
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return { kind: "candidate" };
  }
  const target = shimTarget(file, content);
  if (target && !existsSync(target)) {
    return {
      kind: "broken",
      broken: { path: file, reason: "points at a missing package", target },
    };
  }
  // PowerShell shims are only inspected (the embedded terminal runs them); CodeDen runs the
  // `.cmd` next to them instead.
  if (ext === ".ps1") return { kind: "skip" };
  return target ? { kind: "candidate", target } : { kind: "candidate" };
}
