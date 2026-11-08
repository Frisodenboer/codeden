import type { Dirent } from "node:fs";
import { chmod, lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { CommandError } from "../errors";

/** Error codes Windows returns while another process still holds a file or folder open. */
const IN_USE = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

export const errorCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error ? String(error.code) : undefined;

/** Run `op`, retrying briefly (about 1.5s for 5 attempts) while the path is in use. */
export async function retry(op: () => Promise<unknown>, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await op();
      return;
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT") return;
      if (!code || !IN_USE.has(code) || attempt >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}

/** Delete a file or link (never what a link points at); clears the read-only flag if needed. */
function removeFile(path: string): Promise<void> {
  return retry(async () => {
    try {
      await unlink(path);
    } catch (error) {
      if (errorCode(error) !== "EPERM" && errorCode(error) !== "EACCES") throw error;
      await chmod(path, 0o666).catch(() => undefined);
      await unlink(path);
    }
  });
}

async function kind(path: string, entry: Dirent): Promise<"dir" | "other"> {
  if (entry.isSymbolicLink()) return "other";
  if (entry.isDirectory()) return "dir";
  if (entry.isFile()) return "other";
  // Some filesystems don't report entry types; ask for this one.
  const stat = await lstat(path).catch(() => undefined);
  return stat?.isDirectory() && !stat.isSymbolicLink() ? "dir" : "other";
}

/**
 * Empty `dir`: files and links are unlinked, real folders are emptied and removed. A symlink
 * or junction is never descended into (Windows reports junctions as links), so nothing
 * outside the tree is touched. Every branch is finished before the first failure is thrown.
 */
async function emptyDir(dir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  const results = await Promise.allSettled(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if ((await kind(path, entry)) !== "dir") return removeFile(path);
      await emptyDir(path);
      await retry(() => rmdir(path));
    }),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}

/** A short, user-facing error for a failed delete or move of the worktree folder `root`. */
export function deleteFailed(root: string, error: unknown): CommandError {
  const file = error && typeof error === "object" && "path" in error ? String(error.path) : root;
  const where = relative(root, file);
  const code = errorCode(error);
  if (code && IN_USE.has(code)) {
    const what = where ? `A file in the worktree is in use (${where})` : "The worktree is in use";
    return new CommandError(
      "worktree_in_use",
      `${what}. Close whatever is using it (a terminal, dev server or editor), then try again.`,
    );
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new CommandError("remove_failed", `Could not delete ${where || root}: ${reason}`);
}

/**
 * Delete a worktree folder without ever following a symlink or junction out of it.
 *
 * `git worktree remove` can't be trusted with this on Windows: Git treats junctions as
 * folders, so it deletes the contents of whatever a live junction points at, and it stops at
 * a dangling one with "Directory not empty". In a pnpm install the packages are deleted before
 * the junctions that point at them, so it fails halfway, after removing `.git`. Node's
 * recursive `rm` is no better here: on Windows it waits for as long as a file stays locked.
 *
 * `.git` goes first, so a delete that a locked file interrupts leaves an orphan folder the
 * next attempt cleans up (never a damaged worktree that looks dirty). Each locked entry is
 * retried for about 1.5s, then this throws `worktree_in_use`.
 */
export async function deleteTree(root: string): Promise<void> {
  try {
    const stat = await lstat(root).catch(() => undefined);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) return await removeFile(root);
    await removeFile(join(root, ".git"));
    await emptyDir(root);
    await retry(() => rmdir(root));
  } catch (error) {
    throw deleteFailed(root, error);
  }
}
