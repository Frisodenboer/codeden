import type { Item, ItemOf, ToolCallItem } from "@codeden/contracts";
import { str } from "../util/text";
import type { SubagentTracker, ThreadCtx } from "./subagents";
import {
  completeToolCall,
  PLAN_TOOL,
  QUESTION_TOOL,
  SUBAGENT_TOOLS,
  TODO_TOOL,
  toolCallItem,
} from "./tools";

type Raw = Record<string, unknown>;
type Todos = ItemOf<"todo_list">["todos"];
type EmitItem = (
  ctx: ThreadCtx,
  phase: "item.started" | "item.updated" | "item.completed",
  item: Item,
) => void;

interface ToolState {
  ctx: ThreadCtx;
  item?: ToolCallItem;
  /** Tools rendered as something other than a tool call. */
  special?: "subagent" | "todo" | "question" | "plan";
  startedAt: number;
}

/**
 * Tracks Claude `tool_use` blocks until their `tool_result`: regular tools become `tool_call`
 * items, TodoWrite a `todo_list` updated in place, ExitPlanMode a `plan`, Agent/Task a
 * subagent (delegated to `SubagentTracker`), and AskUserQuestion is left to `canUseTool`.
 */
export class ToolTracker {
  private readonly tools = new Map<string, ToolState>();
  private readonly todos = new Map<string, { id: string; turnId: string; todos: Todos }>();

  constructor(
    private readonly cwd: string,
    private readonly emitItem: EmitItem,
    private readonly subagents: SubagentTracker,
    private readonly newId: () => string,
  ) {}

  /** Thread/turn a tool call runs in. */
  ctx(toolUseId: string): ThreadCtx | undefined {
    return this.tools.get(toolUseId)?.ctx;
  }

  /** A regular tool started streaming (input not known yet). */
  startStreamed(ctx: ThreadCtx, id: string, name: string): void {
    const item = toolCallItem(id, name, {}, this.cwd);
    this.tools.set(id, { ctx, item, startedAt: Date.now() });
    this.emitItem(ctx, "item.started", item);
  }

  /** A complete `tool_use` block arrived in an assistant message. */
  onToolUse(ctx: ThreadCtx, id: string, name: string, input: Raw): void {
    const now = Date.now();
    if (SUBAGENT_TOOLS.has(name)) {
      this.tools.set(id, { ctx, special: "subagent", startedAt: now });
      this.subagents.start(ctx, id, input);
      return;
    }
    if (name === TODO_TOOL) {
      this.tools.set(id, { ctx, special: "todo", startedAt: now });
      this.updateTodos(ctx, input.todos);
      return;
    }
    if (name === QUESTION_TOOL) {
      this.tools.set(id, { ctx, special: "question", startedAt: now });
      return;
    }
    if (name === PLAN_TOOL) {
      this.tools.set(id, { ctx, special: "plan", startedAt: now });
      const plan = str(input, "plan");
      if (plan) {
        this.emitItem(ctx, "item.completed", {
          id: `plan-${id}`,
          kind: "plan",
          status: "completed",
          text: plan,
        });
      }
      return;
    }
    const item = toolCallItem(id, name, input, this.cwd);
    const existing = this.tools.get(id);
    this.tools.set(id, { ctx, item, startedAt: existing?.startedAt ?? now });
    this.emitItem(ctx, existing ? "item.updated" : "item.started", item);
  }

  /** A `tool_result` arrived. */
  onToolResult(
    toolUseId: string,
    content: unknown,
    isError: boolean,
    toolUseResult: unknown,
  ): void {
    const state = this.tools.get(toolUseId);
    if (!state) return;
    this.tools.delete(toolUseId);
    if (state.special === "subagent") {
      this.subagents.onToolResult(toolUseId, content, isError, toolUseResult);
      return;
    }
    if (state.special || !state.item) return;
    const done = completeToolCall(state.item, {
      content,
      isError,
      toolUseResult,
      durationMs: Date.now() - state.startedAt,
    });
    this.emitItem(state.ctx, "item.completed", done);
  }

  /** A thread's turn is ending: cancel open tool calls and complete its todo list. */
  finishTurn(ctx: ThreadCtx, ok: boolean): void {
    for (const [id, state] of this.tools) {
      if (state.ctx.turnId !== ctx.turnId) continue;
      if (state.item) this.emitItem(ctx, "item.completed", { ...state.item, status: "cancelled" });
      if (state.special !== "subagent") this.tools.delete(id);
    }
    const todo = this.todos.get(ctx.threadId);
    if (todo && todo.turnId === ctx.turnId) {
      this.todos.delete(ctx.threadId);
      this.emitItem(ctx, "item.completed", {
        id: todo.id,
        kind: "todo_list",
        status: ok ? "completed" : "cancelled",
        todos: todo.todos,
      });
    }
  }

  private updateTodos(ctx: ThreadCtx, raw: unknown): void {
    const list = Array.isArray(raw) ? raw : [];
    const todos: Todos = list.map((t, i) => {
      const status = str(t, "status");
      return {
        id: String(i + 1),
        text: str(t, "content") ?? str(t, "activeForm") ?? "",
        status: status === "in_progress" || status === "completed" ? status : "pending",
      };
    });
    const existing = this.todos.get(ctx.threadId);
    if (existing && existing.turnId === ctx.turnId) {
      existing.todos = todos;
      this.emitItem(ctx, "item.updated", {
        id: existing.id,
        kind: "todo_list",
        status: "in_progress",
        todos,
      });
      return;
    }
    const id = `todos-${this.newId()}`;
    this.todos.set(ctx.threadId, { id, turnId: ctx.turnId, todos });
    this.emitItem(ctx, "item.started", { id, kind: "todo_list", status: "in_progress", todos });
  }
}
