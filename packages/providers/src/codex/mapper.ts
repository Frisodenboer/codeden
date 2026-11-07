import type { AgentEvent, Item, ItemOf, Usage } from "@codeden/contracts";
import { count, unixToIso } from "../util/text";
import { mapThreadItem, startedItem } from "./items";
import type { ServerNotification } from "./protocol";
import type { RateLimitSnapshot, ThreadTokenUsage, Turn } from "./protocol/v2";

type Todo = ItemOf<"todo_list">["todos"][number];

/**
 * Translates `codex app-server` notifications for one thread into normalized `AgentEvent`s.
 * Codex turn and item ids are used as-is (they are unique UUIDs / call ids).
 */
export class CodexEventMapper {
  readonly rootThreadId: string;
  /** Codex thread id (also the resume token). */
  codexThreadId: string | undefined;
  private turnId: string | undefined;
  private readonly open = new Map<string, Item>();
  private plan: { id: string; todos: Todo[] } | undefined;

  constructor(
    sessionId: string,
    private readonly emit: (event: AgentEvent) => void,
  ) {
    this.rootThreadId = `${sessionId}:thread-root`;
  }

  get currentTurnId(): string | undefined {
    return this.turnId;
  }

  /** Start a turn by id (from the `turn/start` response or `turn/started`). Idempotent. */
  beginTurn(turnId: string): void {
    if (this.turnId === turnId) return;
    if (this.turnId) this.endTurn({ type: "interrupted" }, this.turnId);
    this.turnId = turnId;
    this.emit({ type: "turn.started", threadId: this.rootThreadId, turnId });
  }

  private ctx(turnId: string): { threadId: string; turnId: string } {
    return { threadId: this.rootThreadId, turnId };
  }

  handle(n: ServerNotification): void {
    const params = n.params as { threadId?: string | null; turnId?: string };
    if (params.threadId && this.codexThreadId && params.threadId !== this.codexThreadId) return;
    switch (n.method) {
      case "turn/started":
        this.beginTurn(n.params.turn.id);
        return;
      case "item/started": {
        const item = startedItem(n.params.item);
        if (!item || item.kind === "user_message") return;
        this.beginTurn(n.params.turnId);
        this.open.set(item.id, item);
        this.emit({ type: "item.started", ...this.ctx(n.params.turnId), item });
        return;
      }
      case "item/completed": {
        const item = mapThreadItem(n.params.item);
        if (!item) return;
        this.beginTurn(n.params.turnId);
        this.open.delete(item.id);
        this.emit({ type: "item.completed", ...this.ctx(n.params.turnId), item });
        return;
      }
      case "item/agentMessage/delta":
      case "item/plan/delta":
      case "item/reasoning/textDelta":
        this.delta(n.params.turnId, n.params.itemId, { type: "text", text: n.params.delta });
        return;
      case "item/reasoning/summaryTextDelta":
        this.delta(n.params.turnId, n.params.itemId, {
          type: "reasoning_summary",
          text: n.params.delta,
        });
        return;
      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta":
        this.delta(n.params.turnId, n.params.itemId, { type: "tool_output", text: n.params.delta });
        return;
      case "turn/plan/updated":
        this.updatePlan(n.params.turnId, n.params.plan);
        return;
      case "thread/tokenUsage/updated":
        this.emit({
          type: "usage.updated",
          ...this.ctx(n.params.turnId),
          usage: tokenUsage(n.params.tokenUsage),
        });
        return;
      case "account/rateLimits/updated":
        this.emit({
          type: "usage.updated",
          threadId: this.rootThreadId,
          ...(this.turnId ? { turnId: this.turnId } : {}),
          usage: rateLimits(n.params.rateLimits),
        });
        return;
      case "model/rerouted":
        this.emit({ type: "session.updated", model: n.params.toModel });
        return;
      case "error":
        this.notice(
          n.params.turnId,
          "warning",
          n.params.error.message,
          n.params.willRetry ? "retrying" : "provider_error",
          !n.params.willRetry,
        );
        return;
      case "warning":
        if (this.turnId)
          this.notice(this.turnId, "warning", n.params.message, "provider_warning", false);
        return;
      case "thread/compacted":
        this.notice(n.params.turnId, "info", "Context compacted", "context_compacted", false);
        return;
      case "turn/completed":
        this.completeTurn(n.params.turn);
        return;
      default:
        return;
    }
  }

  private delta(
    turnId: string,
    itemId: string,
    delta: { type: "text" | "reasoning_summary" | "tool_output"; text: string },
  ): void {
    if (!delta.text) return;
    this.beginTurn(turnId);
    this.emit({ type: "item.delta", ...this.ctx(turnId), itemId, delta });
  }

  private notice(
    turnId: string,
    level: "info" | "warning",
    message: string,
    code: string,
    asError: boolean,
  ): void {
    const id = `${code}-${turnId}-${Date.now().toString(36)}`;
    const item: Item = asError
      ? { id, kind: "error", status: "completed", error: { code, message } }
      : { id, kind: "notice", status: "completed", level, code, message };
    this.emit({ type: "item.completed", ...this.ctx(turnId), item });
  }

  private updatePlan(turnId: string, steps: { step: string; status: string }[]): void {
    this.beginTurn(turnId);
    const todos: Todo[] = steps.map((s, i) => ({
      id: String(i + 1),
      text: s.step,
      status:
        s.status === "inProgress"
          ? "in_progress"
          : s.status === "completed"
            ? "completed"
            : "pending",
    }));
    if (this.plan) {
      this.plan.todos = todos;
      this.emit({
        type: "item.updated",
        ...this.ctx(turnId),
        item: { id: this.plan.id, kind: "todo_list", status: "in_progress", todos },
      });
    } else {
      this.plan = { id: `todos-${turnId}`, todos };
      this.emit({
        type: "item.started",
        ...this.ctx(turnId),
        item: { id: this.plan.id, kind: "todo_list", status: "in_progress", todos },
      });
    }
  }

  private completeTurn(turn: Turn): void {
    this.beginTurn(turn.id);
    if (turn.status === "completed") this.endTurn({ type: "completed" }, turn.id);
    else if (turn.status === "interrupted") this.endTurn({ type: "interrupted" }, turn.id);
    else {
      const message = turn.error?.message ?? "Codex turn failed";
      this.endTurn(
        { type: "failed", message, detail: turn.error?.additionalDetails ?? undefined },
        turn.id,
      );
    }
  }

  /** Close the current turn (also used when the process dies). */
  endTurn(
    outcome:
      | { type: "completed" }
      | { type: "interrupted" }
      | { type: "failed"; message: string; detail?: string; code?: string },
    turnId = this.turnId,
  ): void {
    if (!turnId || turnId !== this.turnId) return;
    const ctx = this.ctx(turnId);
    const ok = outcome.type === "completed";
    for (const item of this.open.values()) {
      this.emit({
        type: "item.completed",
        ...ctx,
        item: { ...item, status: ok ? "completed" : "cancelled" } as Item,
      });
    }
    this.open.clear();
    if (this.plan) {
      this.emit({
        type: "item.completed",
        ...ctx,
        item: {
          id: this.plan.id,
          kind: "todo_list",
          status: ok ? "completed" : "cancelled",
          todos: this.plan.todos,
        },
      });
      this.plan = undefined;
    }
    this.turnId = undefined;
    if (outcome.type === "completed")
      this.emit({ type: "turn.completed", ...ctx, stopReason: "end_turn" });
    else if (outcome.type === "interrupted")
      this.emit({ type: "turn.interrupted", ...ctx, reason: "user" });
    else {
      this.emit({
        type: "turn.failed",
        ...ctx,
        error: {
          code: outcome.code ?? "turn_failed",
          message: outcome.message,
          ...(outcome.detail ? { detail: outcome.detail } : {}),
        },
      });
    }
  }
}

/** Codex token usage (cumulative `total`, context from `last`). */
export function tokenUsage(u: ThreadTokenUsage): Usage {
  const usage: Usage = {
    inputTokens: count(u.total.inputTokens),
    outputTokens: count(u.total.outputTokens),
    cachedInputTokens: count(u.total.cachedInputTokens),
    cacheWriteTokens: count(u.total.cacheWriteInputTokens),
    reasoningTokens: count(u.total.reasoningOutputTokens),
    contextTokens: count(u.last.totalTokens),
  };
  if (u.modelContextWindow && u.modelContextWindow > 0)
    usage.contextWindow = Math.round(u.modelContextWindow);
  return usage;
}

function windowId(minutes: number | null, fallback: string): string {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "weekly";
  if (minutes && minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60}h`;
  return fallback;
}

/** Codex rate-limit snapshot -> usage rate limits. */
export function rateLimits(snapshot: RateLimitSnapshot): Usage {
  const out: NonNullable<Usage["rateLimits"]> = [];
  for (const [name, w] of [
    ["primary", snapshot.primary],
    ["secondary", snapshot.secondary],
  ] as const) {
    if (!w) continue;
    const used = Math.min(100, Math.max(0, w.usedPercent));
    const resetsAt = unixToIso(w.resetsAt);
    out.push({
      id: windowId(w.windowDurationMins, name),
      status:
        snapshot.rateLimitReachedType || used >= 100 ? "limited" : used >= 80 ? "warning" : "ok",
      usedPercent: used,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return { rateLimits: out };
}
