import type { QueuedMessage, QueueSender, UserInput } from "@codeden/contracts";
import { ApiRequestError } from "../http";
import type { QueueApi } from "../queue-api";
import { uid } from "./live";
import type { MockWorld } from "./world";

/**
 * Queued messages for the mock client, with the same `message.*` events the server emits so
 * the tray updates live. Delivery `shift`s a message out; acting on it afterwards fails with
 * the server's 409 `already_sent`.
 */
export class MockQueue {
  private readonly bySession = new Map<string, QueuedMessage[]>();
  private readonly sent = new Set<string>();

  constructor(private readonly world: MockWorld) {}

  push(sessionId: string, input: UserInput, from: QueueSender = "user"): QueuedMessage {
    const message: QueuedMessage = {
      id: uid("q"),
      sessionId,
      input,
      from,
      createdAt: new Date().toISOString(),
    };
    this.bySession.set(sessionId, [...this.list(sessionId), message]);
    this.world.emitDomain({ type: "message.queued", sessionId, payload: { message } });
    return message;
  }

  list(sessionId: string): QueuedMessage[] {
    return this.bySession.get(sessionId) ?? [];
  }

  count(sessionId: string): number {
    return this.list(sessionId).length;
  }

  /** Take the next message for delivery. */
  shift(sessionId: string): QueuedMessage | undefined {
    const next = this.list(sessionId)[0];
    if (next) this.take(next, "sent");
    return next;
  }

  /** Drop everything (interrupt, stop). */
  clear(sessionId: string): void {
    for (const m of this.list(sessionId)) this.take(m, "dropped");
  }

  /** The tray API; send-now `steer`s the running turn, like the server. */
  api(turn: {
    running: (sessionId: string) => boolean;
    steer: (sessionId: string, input: UserInput) => Promise<void>;
  }): QueueApi {
    return {
      list: async (sessionId) => structuredClone(this.list(sessionId)),
      edit: async (sessionId, messageId, text) => {
        const message = this.require(sessionId, messageId);
        const next = { ...message, input: { ...message.input, text } };
        this.bySession.set(
          sessionId,
          this.list(sessionId).map((m) => (m.id === messageId ? next : m)),
        );
        this.world.emitDomain({
          type: "message.edited",
          sessionId,
          payload: { sessionId, messageId, text, at: new Date().toISOString() },
        });
        return structuredClone(next);
      },
      remove: async (sessionId, messageId) => {
        this.take(this.require(sessionId, messageId), "deleted");
      },
      sendNow: async (sessionId, messageId) => {
        const message = this.require(sessionId, messageId);
        if (!turn.running(sessionId)) {
          throw new ApiRequestError(
            409,
            "no_turn",
            "No turn is running: the queue sends this message next",
          );
        }
        this.take(message, "sent");
        await turn.steer(sessionId, message.input);
        return { status: "steered" };
      },
    };
  }

  private take(message: QueuedMessage, reason: "sent" | "dropped" | "deleted"): void {
    const { sessionId } = message;
    this.bySession.set(
      sessionId,
      this.list(sessionId).filter((m) => m.id !== message.id),
    );
    if (reason === "sent") this.sent.add(message.id);
    this.world.emitDomain({
      type: "message.dequeued",
      sessionId,
      payload: { sessionId, messageId: message.id, reason },
    });
  }

  private require(sessionId: string, messageId: string): QueuedMessage {
    const message = this.list(sessionId).find((m) => m.id === messageId);
    if (message) return message;
    if (this.sent.has(messageId)) {
      throw new ApiRequestError(409, "already_sent", "This message was already sent");
    }
    throw new ApiRequestError(409, "no_longer_queued", "This message is no longer queued");
  }
}
