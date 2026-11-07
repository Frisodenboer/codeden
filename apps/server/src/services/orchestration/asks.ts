import type { AgentEventOf, Item, RawEventEnvelope } from "@codeden/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items } from "../../db/schema";

/** The marker that ties a PM turn to an `ask_pm` call. */
export const askMarker = (askId: string) => `(ask ${askId})`;

export type AskOutcome = { status: "answered"; text: string } | { status: "pending" };

interface Waiter {
  askId: string;
  pmSessionId: string;
  projectId: string;
  fromSessionId: string | null;
  turnId: string | undefined;
  /** Set while an `ask_pm` call is waiting. */
  resolve: ((text: string) => void) | undefined;
  /** The call timed out: the reply is delivered to the orchestrator as a message. */
  late: boolean;
  createdAt: number;
}

export interface PmAsksDeps {
  db: Db;
  /** A reply that arrived after the `ask_pm` call gave up. */
  onLateReply: (reply: { projectId: string; pmSessionId: string; text: string }) => void;
}

const MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * `ask_pm` replies (§8.3). The question goes to the PM as a message carrying a marker; the
 * PM's turn that handles it is found by the marker in its user message, and the final
 * assistant message of that turn is the answer (or a `message_orchestrator` call with
 * `replyTo`, whichever comes first). If the call times out, the answer still reaches the
 * orchestrator later, as a message.
 */
export class PmAsks {
  private readonly waiters = new Map<string, Waiter>();

  constructor(private readonly deps: PmAsksDeps) {}

  register(
    askId: string,
    target: { pmSessionId: string; projectId: string; fromSessionId: string | null },
  ): void {
    this.prune();
    this.waiters.set(askId, {
      askId,
      ...target,
      turnId: undefined,
      resolve: undefined,
      late: false,
      createdAt: Date.now(),
    });
  }

  /** Wait for the answer to a registered ask. */
  wait(askId: string, timeoutMs: number, signal?: AbortSignal): Promise<AskOutcome> {
    const waiter = this.waiters.get(askId);
    if (!waiter) return Promise.resolve({ status: "pending" });
    return new Promise<AskOutcome>((resolve) => {
      const done = (outcome: AskOutcome) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        waiter.resolve = undefined;
        resolve(outcome);
      };
      const giveUp = () => {
        waiter.late = true;
        done({ status: "pending" });
      };
      const onAbort = () => giveUp();
      const timer = setTimeout(giveUp, timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      waiter.resolve = (text) => done({ status: "answered", text });
    });
  }

  /** An explicit reply (`message_orchestrator` with `replyTo`). True when it matched an ask. */
  answer(askId: string, text: string): boolean {
    const waiter = this.waiters.get(askId);
    if (!waiter) return false;
    this.finish(waiter, text);
    return true;
  }

  /** Follow committed events: find the answering turn, then its final message. */
  onEvents(events: RawEventEnvelope[]): void {
    if (this.waiters.size === 0) return;
    for (const e of events) {
      if (!e.sessionId) continue;
      if (e.type === "agent.item.started" || e.type === "agent.item.completed") {
        const event = e.payload as AgentEventOf<"item.completed">;
        const item: Item = event.item;
        if (item.kind !== "user_message") continue;
        for (const w of this.waiters.values()) {
          if (
            w.pmSessionId === e.sessionId &&
            !w.turnId &&
            item.input.text.includes(askMarker(w.askId))
          ) {
            w.turnId = event.turnId;
          }
        }
      } else if (
        e.type === "agent.turn.completed" ||
        e.type === "agent.turn.failed" ||
        e.type === "agent.turn.interrupted"
      ) {
        const event = e.payload as AgentEventOf<"turn.completed">;
        for (const w of [...this.waiters.values()]) {
          if (w.pmSessionId !== e.sessionId || w.turnId !== event.turnId) continue;
          const text =
            this.finalMessage(w.pmSessionId, event.turnId) ??
            (e.type === "agent.turn.completed"
              ? "(The PM finished without a reply.)"
              : "(The PM's turn ended before it replied.)");
          this.finish(w, text);
        }
      }
    }
  }

  /** Whether any ask is still waiting for its turn (tests). */
  get size(): number {
    return this.waiters.size;
  }

  private finish(waiter: Waiter, text: string): void {
    this.waiters.delete(waiter.askId);
    if (waiter.resolve) waiter.resolve(text);
    else if (waiter.late) {
      const reply = { projectId: waiter.projectId, pmSessionId: waiter.pmSessionId, text };
      setImmediate(() => this.deps.onLateReply(reply));
    }
  }

  private finalMessage(sessionId: string, turnId: string): string | null {
    return finalAssistantMessage(this.deps.db, sessionId, turnId);
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [id, w] of this.waiters)
      if (w.createdAt < cutoff && !w.resolve) this.waiters.delete(id);
  }
}

/** Final assistant message of a turn (shared with notice derivation). */
export function finalAssistantMessage(db: Db, sessionId: string, turnId: string): string | null {
  const rows = db
    .select()
    .from(items)
    .where(
      and(
        eq(items.sessionId, sessionId),
        eq(items.turnId, turnId),
        eq(items.kind, "assistant_message"),
      ),
    )
    .orderBy(desc(items.position))
    .limit(5)
    .all();
  for (const row of rows) {
    if (row.data.kind === "assistant_message" && row.data.text.trim()) return row.data.text.trim();
  }
  return null;
}
