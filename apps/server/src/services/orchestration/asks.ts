import type { AgentEventOf, Item, RawEventEnvelope, Session } from "@codeden/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items } from "../../db/schema";

/** The marker that ties a PM turn to an `ask_pm` call. */
export const askMarker = (askId: string) => `(ask ${askId})`;

const MARKER = /\(ask ([0-9a-f]{8})\)/g;

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

/** An answer the `ask_pm` call didn't wait for; it reaches the orchestrator as a message. */
export interface LateReply {
  askId: string;
  projectId: string;
  pmSessionId: string;
  text: string;
}

export interface PmAsksDeps {
  db: Db;
  /** A session by id (to tell PMs from other sessions). */
  session: (sessionId: string) => Session | undefined;
  /** A reply that arrived after the `ask_pm` call gave up, or that no call waits for. */
  onLateReply: (reply: LateReply) => void;
}

/** Asks answered recently (kept so a turn's answer is never sent twice). */
const SETTLED_LIMIT = 500;

const MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * `ask_pm` replies (§8.3). The question goes to the PM as a message carrying a marker; the
 * PM's turn that handles it is found by the marker in its user message, and the final
 * assistant message of that turn is the answer (or a `message_orchestrator` call with
 * `replyTo`, whichever comes first). If the call times out, the answer still reaches the
 * orchestrator later, as a message. So does the answer to an ask nothing tracks any more (a
 * restart, an ask older than six hours): the marker in the turn's input is enough.
 */
export class PmAsks {
  private readonly waiters = new Map<string, Waiter>();
  private readonly settled = new Set<string>();

  constructor(private readonly deps: PmAsksDeps) {}

  /**
   * Track an ask. A `detached` ask has no call waiting for it (the loop guard held the
   * question back): its answer reaches the orchestrator as a message.
   */
  register(
    askId: string,
    target: { pmSessionId: string; projectId: string; fromSessionId: string | null },
    opts: { detached?: boolean } = {},
  ): void {
    this.prune();
    this.waiters.set(askId, {
      askId,
      ...target,
      turnId: undefined,
      resolve: undefined,
      late: opts.detached ?? false,
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
    for (const e of events) {
      if (!e.sessionId) continue;
      if (e.type === "agent.turn.completed") {
        this.answerUntracked(e.sessionId, (e.payload as AgentEventOf<"turn.completed">).turnId);
      }
      if (this.waiters.size === 0) continue;
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
    this.settle(waiter.askId);
    if (waiter.resolve) waiter.resolve(text);
    else if (waiter.late) {
      const { askId, projectId, pmSessionId } = waiter;
      setImmediate(() => this.deps.onLateReply({ askId, projectId, pmSessionId, text }));
    }
  }

  /**
   * A PM's turn completed: answer the asks in its input that no waiter tracks (registered
   * before a restart, or pruned). Tracked ones are answered by their waiter instead.
   */
  private answerUntracked(sessionId: string, turnId: string): void {
    const session = this.deps.session(sessionId);
    if (session?.role !== "pm" || !session.projectId) return;
    const projectId = session.projectId;
    const askIds = new Set<string>();
    for (const row of this.deps.db
      .select()
      .from(items)
      .where(
        and(
          eq(items.sessionId, sessionId),
          eq(items.turnId, turnId),
          eq(items.kind, "user_message"),
        ),
      )
      .all()) {
      if (row.data.kind !== "user_message") continue;
      for (const m of row.data.input.text.matchAll(MARKER)) if (m[1]) askIds.add(m[1]);
    }
    const untracked = [...askIds].filter((id) => !this.waiters.has(id) && !this.settled.has(id));
    if (untracked.length === 0) return;
    const text = this.finalMessage(sessionId, turnId) ?? "(The PM finished without a reply.)";
    for (const askId of untracked) {
      this.settle(askId);
      setImmediate(() => this.deps.onLateReply({ askId, projectId, pmSessionId: sessionId, text }));
    }
  }

  private settle(askId: string): void {
    this.settled.add(askId);
    if (this.settled.size <= SETTLED_LIMIT) return;
    const oldest = this.settled.values().next().value;
    if (oldest !== undefined) this.settled.delete(oldest);
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
