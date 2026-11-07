import type { Session, UpdateSessionRequest } from "@codeden/contracts";
import { type RunnerPort, runnerErrorCode } from "../runner-port";
import type { SessionRepo, StoredStartMeta } from "./repo";

/** A model/effort change waiting for the session's next turn. */
export type PendingConfig = { model?: string | null; effort?: Session["effort"] };

function fallbackMeta(): StoredStartMeta {
  return { workspaceMode: "worktree", workspaceFallback: null, forced: null, queuedBehind: [] };
}

/**
 * `PATCH /api/sessions/:id`: update model, effort or title. Model and effort changes are
 * remembered as pending and applied right before the next turn (`applyPendingConfig`), so a
 * running turn keeps its settings.
 */
export function updateSession(repo: SessionRepo, id: string, req: UpdateSessionRequest): Session {
  const change: PendingConfig = {};
  if (req.model !== undefined) change.model = req.model;
  if (req.effort !== undefined) change.effort = req.effort;
  const session = repo.update(id, (s) => ({
    ...s,
    ...(change.model !== undefined ? { model: change.model } : {}),
    ...(change.effort !== undefined ? { effort: change.effort } : {}),
    ...(req.title !== undefined ? { title: req.title } : {}),
  }));
  if (Object.keys(change).length > 0) {
    repo.setStartMeta(id, (m) => {
      const meta = (m ?? fallbackMeta()) as StoredStartMeta & { pendingConfig?: PendingConfig };
      return { ...meta, pendingConfig: { ...meta.pendingConfig, ...change } } as StoredStartMeta;
    });
  }
  return session;
}

/**
 * Apply a pending model/effort change on the runner before the next turn. When the runner no
 * longer hosts the session, the resume that follows opens it with the new settings anyway.
 * Returns a warning when the provider cannot change them live (they apply on the next resume).
 */
export async function applyPendingConfig(
  repo: SessionRepo,
  runner: RunnerPort,
  session: Session,
): Promise<string | undefined> {
  const meta = repo.find(session.id)?.startMeta as
    | (StoredStartMeta & { pendingConfig?: PendingConfig })
    | null
    | undefined;
  const pending = meta?.pendingConfig;
  if (!pending) return undefined;
  const clear = () =>
    repo.setStartMeta(session.id, (m) => {
      const { pendingConfig: _done, ...rest } = (m ?? fallbackMeta()) as StoredStartMeta & {
        pendingConfig?: PendingConfig;
      };
      return rest;
    });
  try {
    await runner.request({ name: "session.configure", sessionId: session.id, ...pending });
    clear();
    return undefined;
  } catch (error) {
    const code = runnerErrorCode(error);
    if (code === "unknown_session") {
      clear();
      return undefined;
    }
    return `Model/effort change not applied live (${code ?? "error"}); it applies when the session is resumed.`;
  }
}
