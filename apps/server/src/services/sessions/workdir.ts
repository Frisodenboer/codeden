import type { Session } from "@codeden/contracts";
import { conflict } from "../errors";

/** Shown wherever a cleaned-up worktree is needed before the session is resumed. */
export const WORKTREE_REMOVED_MESSAGE =
  "This session's worktree was cleaned up. Send the session a message to recreate it from its branch.";

/**
 * Directory a session's files, git commands and terminals use: its worktree, else its cwd.
 * Throws `worktree_removed` (409) once cleanup removed the worktree; the next message to the
 * session recreates it (§9).
 */
export function sessionWorkdir(session: Session): string {
  if (session.worktreePath && session.worktreeRemovedAt) {
    throw conflict(WORKTREE_REMOVED_MESSAGE, "worktree_removed");
  }
  return session.worktreePath ?? session.cwd;
}
