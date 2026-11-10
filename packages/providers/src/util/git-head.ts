import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The branch checked out in the repository at `dir` (its `.git` folder, or the `gitdir:` a
 * worktree's `.git` file points to), read straight from `HEAD`. Undefined when detached, when
 * `dir` is not a repository root, or on any error. Reads files only; never runs git.
 */
export function currentGitBranch(dir: string): string | undefined {
  try {
    const marker = path.join(dir, ".git");
    let gitDir = marker;
    if (statSync(marker).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, "utf8"))?.[1]?.trim();
      if (!pointer) return undefined;
      gitDir = path.resolve(dir, pointer);
    }
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    return /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  } catch {
    return undefined;
  }
}
