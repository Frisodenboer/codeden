import {
  agentEventToNewEvent,
  type NewEvent,
  type RawEventEnvelope,
  type RunnerEventMessage,
} from "@codeden/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { runnerState } from "../db/schema";
import { derivedEvents } from "./projection-db";
import { reduceProcessEvent } from "./reducer/process";
import type { ProjectionReader } from "./reducer/types";
import type { EventStore } from "./store";

/** Server events produced by one durable runner event (pure apart from the reader). */
export function runnerEventToNewEvents(
  reader: ProjectionReader,
  msg: RunnerEventMessage,
): NewEvent[] {
  const event = msg.event;
  switch (event.kind) {
    case "agent":
      return [agentEventToNewEvent(event.sessionId, event.event)];
    case "session.process":
      return derivedEvents(reduceProcessEvent(reader, event, msg.seq, msg.ts));
    // Setup output, terminal exits and drains become notices in a later milestone.
    case "workspace.setup":
    case "pty.exited":
    case "runner.draining":
      return [];
  }
}

export interface IngestResult {
  /** False when the event was already stored (replayed after a reconnect). */
  stored: boolean;
  events: RawEventEnvelope[];
  /** Seq to acknowledge to the runner. */
  ackSeq: number;
}

/** Highest runner seq durably stored for `runnerId`. */
export function lastAckedSeq(db: Db, runnerId: string): number {
  return (
    db.select().from(runnerState).where(eq(runnerState.runnerId, runnerId)).get()?.lastAckedSeq ?? 0
  );
}

/**
 * The event pipeline (§4.2, §6): store one runner event and its projections, and advance the
 * runner's acked seq in the same transaction. Idempotent by runner seq: replays at or below
 * the stored position are acknowledged without storing anything again.
 */
export function ingestRunnerEvent(
  db: Db,
  store: EventStore,
  runnerId: string,
  msg: RunnerEventMessage,
): IngestResult {
  if (msg.seq <= lastAckedSeq(db, runnerId)) {
    return { stored: false, events: [], ackSeq: msg.seq };
  }
  const now = new Date().toISOString();
  const events = store.appendFrom(
    (reader) => runnerEventToNewEvents(reader, msg),
    (tx) => {
      tx.insert(runnerState)
        .values({ runnerId, lastAckedSeq: msg.seq, updatedAt: now })
        .onConflictDoUpdate({
          target: runnerState.runnerId,
          set: { lastAckedSeq: msg.seq, updatedAt: now },
        })
        .run();
    },
  );
  return { stored: true, events, ackSeq: msg.seq };
}
