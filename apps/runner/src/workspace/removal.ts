import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { RunnerCommandOf, RunnerCommandResult } from "@codeden/contracts";
import { CommandError } from "../errors";
import { git, gitText } from "../git/exec";
import { isInside } from "../util/paths";
import { discardFolder, isManagedWorktreePath } from "./trash";

/**
 * Where a worktree path stands:
 * - `missing`: nothing is there.
 * - `registered`: a linked worktree of the repository (a `.git` file, listed by git).
 * - `orphan`: a folder without `.git`, such as what an interrupted removal leaves behind.
 * - `foreign`: something git-managed that isn't a linked worktree of this repository (the
 *   repository itself, another clone, a worktree of another repository). Never removed.
 */
export type WorktreeState = "missing" | "registered" | "orphan" | "foreign";

export interface WorktreeInfo {
  state: WorktreeState;
  /** Listed by `git worktree list` (also when its folder is gone or half-deleted). */
  registered: boolean;
  /** Locked with `git worktree lock`. */
  locked: boolean;
  /** The repository or another worktree lies inside the path. */
  containsOther: boolean;
}

async function canonical(path: string): Promise<string> {
  const real = await realpath(path).catch(() => resolve(path));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

async function listWorktrees(repo: string): Promise<{ path: string; locked: boolean }[]> {
  const out = await gitText(repo, ["worktree", "list", "--porcelain"]).catch(() => "");
  const list: { path: string; locked: boolean }[] = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    if (!lines[0]?.startsWith("worktree ")) continue;
    const locked = lines.some((l) => l === "locked" || l.startsWith("locked "));
    list.push({ path: lines[0].slice("worktree ".length), locked });
  }
  return list;
}

/** Classify `path` against the worktrees of `repo` (see `WorktreeState`). */
export async function worktreeState(repo: string, path: string): Promise<WorktreeInfo> {
  const target = await canonical(path);
  let registered = false;
  let locked = false;
  let containsOther = false;
  for (const wt of await listWorktrees(repo)) {
    const other = await canonical(wt.path);
    if (other === target) {
      registered = true;
      locked = wt.locked;
    } else if (isInside(target, other)) {
      containsOther = true;
    }
  }
  if (isInside(target, await canonical(repo))) containsOther = true;

  const info = { registered, locked, containsOther };
  const stat = await lstat(path).catch(() => undefined);
  if (!stat) return { state: "missing", ...info };
  if (stat.isSymbolicLink() || !stat.isDirectory()) return { state: "orphan", ...info };
  const dotGit = await lstat(resolve(path, ".git")).catch(() => undefined);
  if (!dotGit) return { state: "orphan", ...info };
  return { state: dotGit.isFile() && registered ? "registered" : "foreign", ...info };
}

/** Whether a registered worktree has uncommitted changes (ignored files don't count). */
async function isDirty(path: string): Promise<boolean> {
  const status = await git(path, ["status", "--porcelain"]);
  return status.stdout.toString("utf8").trim() !== "";
}

/**
 * Decide whether `workspace.remove` may delete the path, before anything is touched (terminals
 * and processes in it are stopped only after this passes). Refuses (`not_a_worktree`) anything
 * that isn't a linked worktree of the repository, unless it is an orphan inside CodeDen's
 * worktree folder, and anything containing the repository or another worktree. Unless forced,
 * keeps a locked worktree (`worktree_locked`) or one with uncommitted changes
 * (`worktree_dirty`); ignored files (build output, `node_modules`) don't count.
 */
export async function assertRemovable(
  cmd: RunnerCommandOf<"workspace.remove">,
  home: string,
): Promise<WorktreeInfo> {
  const path = resolve(cmd.path);
  const info = await worktreeState(cmd.repoPath, path);
  const leftAlone = (why: string) =>
    new CommandError("not_a_worktree", `${path} ${why}, so it was left alone`);
  if (info.state === "missing") return info;
  if (info.containsOther) throw leftAlone("contains the repository or another worktree");
  if (info.state === "foreign") throw leftAlone("is not a worktree of this repository");
  if (info.state === "orphan" && !isManagedWorktreePath(home, path)) {
    throw leftAlone("is no longer a git worktree and is outside CodeBench's worktree folder");
  }
  if (info.state !== "registered" || cmd.force) return info;
  if (info.locked) {
    throw new CommandError(
      "worktree_locked",
      `${path} is locked; unlock it or remove it with force`,
    );
  }
  if (await isDirty(path)) {
    throw new CommandError(
      "worktree_dirty",
      `${path} has uncommitted changes; commit them or remove it with force`,
    );
  }
  return info;
}

/** Drop git's records of worktrees whose folders are gone. */
export async function pruneWorktrees(repo: string): Promise<void> {
  await git(repo, ["worktree", "prune"]).catch(() => undefined);
}

/**
 * `workspace.remove`: delete a session worktree and git's record of it. Idempotent: a missing
 * path, or a half-deleted orphan inside `<home>/wt`, ends removed too. The folder goes to the
 * trash or is deleted in place, never through a link (`discardFolder`), then
 * `git worktree prune` drops the record. The branch stays unless `deleteBranch` names it.
 */
export async function removeWorkspace(
  cmd: RunnerCommandOf<"workspace.remove">,
  home: string,
  log?: (message: string) => void,
): Promise<RunnerCommandResult<"workspace.remove">> {
  const path = resolve(cmd.path);
  const info = await assertRemovable(cmd, home);
  const registered = info.state === "registered";
  const discardedChanges = registered && cmd.force === true && (await isDirty(path));
  try {
    if (registered && info.locked) {
      await git(cmd.repoPath, ["worktree", "unlock", path]).catch(() => undefined);
    }
    if (info.state !== "missing") await discardFolder(home, path, log);
  } finally {
    // Also after a failure: if an in-place delete got past `.git`, the record is stale and the
    // leftover folder is an orphan the next attempt deletes.
    await pruneWorktrees(cmd.repoPath);
  }
  if (cmd.deleteBranch) {
    await git(cmd.repoPath, ["branch", "-D", cmd.deleteBranch]).catch(() => undefined);
  }
  return { removed: true, ...(discardedChanges ? { discardedChanges } : {}) };
}
