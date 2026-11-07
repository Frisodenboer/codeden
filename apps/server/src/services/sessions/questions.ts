import { randomUUID } from "node:crypto";
import type { ItemOf, ItemRecord, RuntimeResponse, UserQuestion } from "@codeden/contracts";
import { agentEventToNewEvent } from "@codeden/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToItemRecord } from "../../db/rows";
import { items } from "../../db/schema";
import type { EventStore } from "../../events/store";
import { conflict } from "../errors";

type Answers = Record<string, string[]>;
type QuestionItem = ItemOf<"user_question">;

/** Outcome of `ask`: answered in time, dismissed, or still waiting in the inbox. */
export type AskOutcome =
  | { status: "answered"; answers: Answers; text: string }
  | { status: "dismissed" }
  | { status: "pending"; requestId: string };

export interface QuestionBrokerDeps {
  db: Db;
  store: EventStore;
  /** Deliver a late answer to the agent as a user message (queued while a turn runs). */
  sendMessage: () => (sessionId: string, text: string) => Promise<void>;
  /** How long `ask` waits before returning `pending`. Default 4 minutes. */
  waitMs?: number;
}

/**
 * Questions agents ask through CodeDen's `ask_user` tool (§8.3). The question becomes a
 * `user_question` item in the current turn, which the projection mirrors into the inbox
 * (and the session waits on it). The tool call blocks for a while; an answer within that
 * time is the tool's result. Otherwise the tool returns "pending", the agent ends its turn,
 * and the answer arrives later as a new user message. This works the same for every
 * provider, whatever its MCP tool timeout.
 */
export class QuestionBroker {
  private readonly waiters = new Map<string, (outcome: AskOutcome) => void>();

  constructor(private readonly deps: QuestionBrokerDeps) {}

  async ask(
    sessionId: string,
    turn: { threadId: string; turnId: string },
    question: Omit<UserQuestion, "id">,
    signal?: AbortSignal,
  ): Promise<AskOutcome> {
    const requestId = randomUUID();
    const item: QuestionItem = {
      id: `ask-${requestId}`,
      kind: "user_question",
      status: "in_progress",
      requestId,
      deferred: true,
      questions: [{ ...question, id: "q1" }],
    };
    const outcome = new Promise<AskOutcome>((resolve) => {
      const timer = setTimeout(() => finish({ status: "pending", requestId }), this.waitMs);
      const finish = (value: AskOutcome) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.waiters.delete(requestId);
        resolve(value);
      };
      const onAbort = () => finish({ status: "pending", requestId });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(requestId, finish);
    });
    this.put(sessionId, turn, item);
    return outcome;
  }

  /**
   * Handle a response if `requestId` belongs to an `ask_user` question. Returns false for
   * provider-native requests (the caller forwards those to the runner).
   */
  async respond(sessionId: string, requestId: string, response: RuntimeResponse): Promise<boolean> {
    const record = this.find(sessionId, requestId);
    if (!record) return false;
    const item = record.item as QuestionItem;
    if (item.status !== "in_progress")
      throw conflict("The question was already answered", "answered");
    const answers = response.kind === "answer" ? response.answers : undefined;
    const done: QuestionItem = answers
      ? { ...item, status: "completed", answers }
      : { ...item, status: "cancelled" };
    this.put(sessionId, record, done);
    const outcome: AskOutcome = answers
      ? { status: "answered", answers, text: formatAnswers(item, answers) }
      : { status: "dismissed" };
    const waiter = this.waiters.get(requestId);
    if (waiter) waiter(outcome);
    else if (outcome.status === "answered") {
      await this.deps.sendMessage()(sessionId, `Answer to your earlier question:\n${outcome.text}`);
    }
    return true;
  }

  private get waitMs(): number {
    return this.deps.waitMs ?? 4 * 60_000;
  }

  private find(sessionId: string, requestId: string): ItemRecord | undefined {
    const rows = this.deps.db
      .select()
      .from(items)
      .where(and(eq(items.sessionId, sessionId), eq(items.kind, "user_question")))
      .all();
    return rows
      .map(rowToItemRecord)
      .find(
        (r) => r.item.kind === "user_question" && r.item.requestId === requestId && r.item.deferred,
      );
  }

  private put(sessionId: string, turn: { threadId: string; turnId: string }, item: QuestionItem) {
    this.deps.store.append([
      agentEventToNewEvent(sessionId, {
        type: item.status === "in_progress" ? "item.started" : "item.completed",
        threadId: turn.threadId,
        turnId: turn.turnId,
        item,
      }),
    ]);
  }
}

/** "Q: ... / A: ..." lines for the agent. */
export function formatAnswers(item: QuestionItem, answers: Answers): string {
  return item.questions
    .map((q) => `Q: ${q.question}\nA: ${(answers[q.id] ?? []).join(", ") || "(no answer)"}`)
    .join("\n\n");
}
