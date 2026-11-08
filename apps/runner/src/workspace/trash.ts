import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { deleteFailed, deleteTree, errorCode, retry } from "./delete-tree";

/**
 * True for a session folder CodeDen created and owns: exactly `<home>/wt/<project>/<session>`.
 * Only these may be deleted once they are no longer git worktrees.
 */
export function isManagedWorktreePath(home: string, path: string): boolean {
  const rel = relative(resolve(home, "wt"), resolve(path));
  if (!rel || isAbsolute(rel)) return false;
  const parts = rel.split(/[\\/]+/);
  return (
    parts.length === 2 && !parts.includes("..") && !parts.includes(".") && parts[0] !== ".trash"
  );
}

/** Where removed worktrees wait to be deleted. `.trash` can never be a project slug. */
export function trashDir(home: string): string {
  return join(resolve(home), "wt", ".trash");
}

/**
 * Move a session folder into the trash. A rename is all or nothing: while anything in the
 * folder is held open (a process's working directory, an open file), Windows refuses it and
 * the folder stays exactly as it was (`worktree_in_use`). Returns null when the trash is on
 * another volume.
 */
async function moveToTrash(home: string, path: string): Promise<string | null> {
  const trash = trashDir(home);
  await mkdir(trash, { recursive: true });
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dest = join(trash, `${basename(dirname(path))}-${basename(path)}-${stamp}`);
  try {
    // Processes just stopped in the folder can take a moment to let go of it.
    await retry(() => rename(path, dest), 8);
    return dest;
  } catch (error) {
    if (errorCode(error) === "EXDEV") return null;
    throw deleteFailed(path, error);
  }
}

const runs = new Map<string, { again: boolean; done: Promise<void> }>();

/**
 * Delete everything in the trash, one folder at a time, never following a link (the links in
 * a trashed pnpm install still point at the old path, where a new worktree may live by now).
 * Runs in the background after each removal and when the runner starts; a folder something
 * still holds open stays for the next run. Calls during a run share it and add one more pass.
 */
export function emptyTrash(home: string, log?: (message: string) => void): Promise<void> {
  const trash = trashDir(home);
  const current = runs.get(trash);
  if (current) {
    current.again = true;
    return current.done;
  }
  const run = { again: true, done: Promise.resolve() };
  run.done = (async () => {
    try {
      while (run.again) {
        run.again = false;
        const entries = await readdir(trash).catch(() => [] as string[]);
        for (const name of entries) {
          await deleteTree(join(trash, name)).catch((error: unknown) =>
            log?.(`worktree trash: ${error instanceof Error ? error.message : String(error)}`),
          );
        }
      }
    } finally {
      runs.delete(trash);
    }
  })();
  runs.set(trash, run);
  return run.done;
}

/**
 * Delete a worktree folder that has been cleared for removal. A session folder under
 * `<home>/wt` goes to the trash, so the removal is instant and the path is free right away,
 * and is deleted in the background. Anything else is deleted in place.
 */
export async function discardFolder(
  home: string,
  path: string,
  log?: (message: string) => void,
): Promise<void> {
  const trashed = isManagedWorktreePath(home, path) ? await moveToTrash(home, path) : null;
  if (trashed) void emptyTrash(home, log);
  else await deleteTree(path);
}
