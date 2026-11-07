import { randomUUID } from "node:crypto";
import type { QueuedMessage, UserInput } from "@codeden/contracts";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { queuedMessages } from "../../db/schema";
import type { EventStore } from "../../events/store";

/**
 * Messages sent while a turn runs, delivered one at a time when the session goes idle.
 * Stored through `message.queued` / `message.dequeued` events, so the queue survives server
 * restarts and can be rebuilt from the log.
 */
export class Outbox {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
  ) {}

  push(sessionId: string, input: UserInput): QueuedMessage {
    const message: QueuedMessage = {
      id: randomUUID(),
      sessionId,
      input,
      createdAt: new Date().toISOString(),
    };
    this.store.append([{ type: "message.queued", sessionId, payload: { message } }]);
    return message;
  }

  /** Oldest queued message of a session, if any. */
  peek(sessionId: string): QueuedMessage | undefined {
    const row = this.db
      .select()
      .from(queuedMessages)
      .where(eq(queuedMessages.sessionId, sessionId))
      .orderBy(asc(queuedMessages.createdAt))
      .limit(1)
      .get();
    return row ?? undefined;
  }

  count(sessionId: string): number {
    return this.db
      .select({ id: queuedMessages.id })
      .from(queuedMessages)
      .where(eq(queuedMessages.sessionId, sessionId))
      .all().length;
  }

  /** Session ids with at least one queued message. */
  sessionsWithMessages(): string[] {
    const rows = this.db
      .selectDistinct({ id: queuedMessages.sessionId })
      .from(queuedMessages)
      .all();
    return rows.map((r) => r.id);
  }

  remove(message: QueuedMessage, reason: "sent" | "dropped"): void {
    this.store.append([
      {
        type: "message.dequeued",
        sessionId: message.sessionId,
        payload: { sessionId: message.sessionId, messageId: message.id, reason },
      },
    ]);
  }

  /** Drop every queued message of a session (interrupt, stop). */
  clear(sessionId: string): void {
    const rows = this.db
      .select()
      .from(queuedMessages)
      .where(eq(queuedMessages.sessionId, sessionId))
      .all();
    if (rows.length === 0) return;
    this.store.append(
      rows.map((m) => ({
        type: "message.dequeued" as const,
        sessionId,
        payload: { sessionId, messageId: m.id, reason: "dropped" as const },
      })),
    );
  }
}
