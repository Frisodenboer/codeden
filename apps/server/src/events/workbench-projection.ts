import type { EventOf, SetupStep } from "@codeden/contracts";
import { eq } from "drizzle-orm";
import { checkpoints, queuedMessages, sessions } from "../db/schema";
import type { StoredStartMeta } from "../services/sessions/repo";
import type { Tx } from "./projection-db";

/** Max characters of setup output kept per step (the tail). */
export const SETUP_OUTPUT_LIMIT = 16_000;

type WorkbenchEvent = EventOf<
  "session.setup" | "checkpoint.created" | "message.queued" | "message.dequeued"
>;

/** Projections for workbench domain events: setup output, checkpoints, queued messages. */
export function applyWorkbenchProjection(tx: Tx, e: WorkbenchEvent): void {
  switch (e.type) {
    case "session.setup": {
      const row = tx
        .select({ startMeta: sessions.startMeta })
        .from(sessions)
        .where(eq(sessions.id, e.payload.sessionId))
        .get();
      if (!row) return;
      const meta: StoredStartMeta = row.startMeta ?? {
        workspaceMode: "worktree",
        workspaceFallback: null,
        forced: null,
        queuedBehind: [],
      };
      const startMeta = { ...meta, setup: mergeSetupStep(meta.setup ?? [], e.payload.step) };
      tx.update(sessions).set({ startMeta }).where(eq(sessions.id, e.payload.sessionId)).run();
      return;
    }
    case "checkpoint.created": {
      const cp = e.payload.checkpoint;
      const row = {
        sessionId: cp.sessionId,
        index: cp.index,
        ref: cp.ref,
        commit: cp.commit,
        turnId: cp.turnId,
        createdAt: cp.createdAt,
      };
      tx.insert(checkpoints)
        .values(row)
        .onConflictDoUpdate({ target: [checkpoints.sessionId, checkpoints.index], set: row })
        .run();
      return;
    }
    case "message.queued": {
      const m = e.payload.message;
      tx.insert(queuedMessages)
        .values({ id: m.id, sessionId: m.sessionId, input: m.input, createdAt: m.createdAt })
        .onConflictDoNothing()
        .run();
      return;
    }
    case "message.dequeued":
      tx.delete(queuedMessages).where(eq(queuedMessages.id, e.payload.messageId)).run();
      return;
  }
}

/**
 * Fold one setup update into the list: output of a running command accumulates on its step
 * (bounded to the tail); a new command starts a new step.
 */
export function mergeSetupStep(steps: SetupStep[], step: SetupStep): SetupStep[] {
  const last = steps.at(-1);
  if (last && last.command === step.command && last.status === "running") {
    const output = tail(`${last.output}${step.output}`);
    return [...steps.slice(0, -1), { ...step, output }];
  }
  return [...steps, { ...step, output: tail(step.output) }];
}

function tail(text: string): string {
  return text.length > SETUP_OUTPUT_LIMIT ? text.slice(-SETUP_OUTPUT_LIMIT) : text;
}
