import type { Session } from "@codeden/contracts";

/**
 * The branch a session owns: its own worktree's branch, never its base branch or a usual
 * default branch. The agent may force-push it with a lease (§11.2).
 */
export function ownBranch(session: Session): string | undefined {
  const { branch, worktreePath, baseBranch } = session;
  if (!branch || !worktreePath || branch === baseBranch) return undefined;
  return ["main", "master", "develop", "trunk"].includes(branch) ? undefined : branch;
}
