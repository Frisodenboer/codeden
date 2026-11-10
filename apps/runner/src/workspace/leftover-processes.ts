import type { ProcessSupervisor } from "../process/supervisor";
import { endProcessesInside, runnerDescendants } from "../process/worktree-processes";
import { isInside } from "../util/paths";
import { isManagedWorktreePath } from "./trash";

export interface LeftoverContext {
  home: string;
  supervisor: ProcessSupervisor;
  /** Working directories of the hosted sessions, by session id. */
  cwds: () => Map<string, string>;
  log?: (message: string) => void;
}

/**
 * Stop a session, then end what its agent left running in its worktree (a dev server started
 * through the agent's shell outlives the agent). Only for a session in its own CodeDen worktree
 * (`<home>/wt/<project>/<session>`), never the repository root or a folder another hosted
 * session works in. The user's terminals there keep running.
 */
export async function stopWithLeftovers(
  ctx: LeftoverContext,
  sessionId: string,
  stop: () => Promise<void>,
): Promise<void> {
  const cwds = ctx.cwds();
  const cwd = cwds.get(sessionId);
  const own =
    cwd !== undefined &&
    isManagedWorktreePath(ctx.home, cwd) &&
    ![...cwds].some(
      ([id, other]) => id !== sessionId && (isInside(cwd, other) || isInside(other, cwd)),
    );
  // Where an orphan is adopted by another process (Linux, macOS), remember what the agent
  // started while it still runs; on Windows its orphans are recognised afterwards.
  const seen = own && process.platform !== "win32" ? await runnerDescendants() : undefined;
  await stop();
  if (!own || cwd === undefined) return;
  await endProcessesInside(cwd, {
    home: ctx.home,
    seen,
    spare: ctx.supervisor.list().map((p) => p.pid),
    log: ctx.log,
  });
}
