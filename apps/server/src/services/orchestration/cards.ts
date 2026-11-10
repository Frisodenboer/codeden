import {
  type AgentEventOf,
  agentEventToNewEvent,
  NOTICE_BATCH_CODE,
  type Notice,
  type RawEventEnvelope,
} from "@codeden/contracts";
import type { EventStore } from "../../events/store";

/**
 * Notices a wake (or any message) delivered to a role session, shown as one batch of cards at
 * the start of the turn that carries them (§8.2: notices stay structured data up to the UI).
 */
export class NoticeCards {
  private readonly pending = new Map<string, Notice[]>();

  constructor(private readonly store: EventStore) {}

  /** Notices delivered with the next turn of `sessionId`. */
  add(sessionId: string, notices: Notice[]): void {
    this.pending.set(sessionId, [...(this.pending.get(sessionId) ?? []), ...notices]);
  }

  /** Forget notices a turn was going to carry: its send failed, they wait for the next one. */
  remove(sessionId: string, ids: string[]): void {
    const left = (this.pending.get(sessionId) ?? []).filter((n) => !ids.includes(n.id));
    if (left.length > 0) this.pending.set(sessionId, left);
    else this.pending.delete(sessionId);
  }

  /** Append the waiting cards to each role session whose turn just started. */
  attach(events: RawEventEnvelope[]): void {
    for (const e of events) {
      if (e.type !== "agent.turn.started" || !e.sessionId) continue;
      const cards = this.pending.get(e.sessionId);
      if (!cards) continue;
      this.pending.delete(e.sessionId);
      const event = e.payload as AgentEventOf<"turn.started">;
      this.store.append([
        agentEventToNewEvent(e.sessionId, {
          type: "item.completed",
          threadId: event.threadId,
          turnId: event.turnId,
          item: {
            id: `notices-${event.turnId}`,
            kind: "notice",
            status: "completed",
            level: "info",
            code: NOTICE_BATCH_CODE,
            message: `${cards.length} update${cards.length === 1 ? "" : "s"} since the last turn`,
            data: JSON.parse(JSON.stringify({ notices: cards })),
          },
        }),
      ]);
    }
  }
}
