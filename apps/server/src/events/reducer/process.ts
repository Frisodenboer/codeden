import type { RunnerEvent, SessionStatus } from "@codeden/contracts";
import { Draft } from "./draft";
import { closeInbox, runFailedInbox } from "./items";
import type { Mutation, ProjectionReader } from "./types";

type ProcessEvent = Extract<RunnerEvent, { kind: "session.process" }>;

const FINAL: ReadonlySet<SessionStatus> = new Set(["completed", "stopped", "failed"]);

/**
 * Provider process lifecycle (runner `session.process` events) -> projection changes. A crash
 * fails the session and raises a `run_failed` inbox item; a normal exit stops it. Either way,
 * open questions and approvals can no longer be answered and are dismissed. Pure.
 */
export function reduceProcessEvent(
  reader: ProjectionReader,
  event: ProcessEvent,
  runnerSeq: number,
  ts: string,
): Mutation[] {
  if (event.state !== "crashed" && event.state !== "exited") return [];
  const d = new Draft(reader);
  const record = d.getSession(event.sessionId);
  if (!record) return [];
  const { session } = record;

  for (const inbox of d.openInboxForSession(session.id)) {
    if (inbox.kind !== "approval" && inbox.kind !== "question") continue;
    d.putInbox(closeInbox(inbox, "dismissed", { status: "cancelled", reason: event.state }, ts));
  }

  if (event.state === "crashed") {
    if (!FINAL.has(session.status)) {
      d.putSession({ ...session, status: "failed", updatedAt: ts }, record.usage);
    }
    const message = event.error?.message ?? "The agent process crashed";
    const id = `inbox:${session.id}:process:${runnerSeq}`;
    d.putInbox(runFailedInbox(session, id, message, session.rootThreadId, ts));
  } else if (!FINAL.has(session.status)) {
    d.putSession(
      { ...session, status: "stopped", endedAt: session.endedAt ?? ts, updatedAt: ts },
      record.usage,
    );
  }
  return d.mutations();
}
