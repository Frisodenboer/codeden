import { randomUUID } from "node:crypto";
import type { AgentEvent, ErrorInfo, Item, ItemOf, ToolCallItem } from "@codeden/contracts";
import { str } from "../util/text";
import { SubagentTracker, type ThreadCtx } from "./subagents";
import {
  completeToolCall,
  isSpecialTool,
  PLAN_TOOL,
  QUESTION_TOOL,
  SUBAGENT_TOOLS,
  TODO_TOOL,
  toolCallItem,
} from "./tools";
import { contextTokensFromMessageUsage, usageFromRateLimit, usageFromResult } from "./usage";

type Raw = Record<string, unknown>;
type Block = Raw & { type?: string };

interface StreamBlock {
  itemId: string;
  type: "text" | "thinking" | "tool_use";
  text: string;
  consumed: boolean;
  completed: boolean;
}

interface ToolState {
  ctx: ThreadCtx;
  item?: ToolCallItem;
  special?: string;
  startedAt: number;
}

export type TurnOutcome =
  | { type: "completed"; stopReason?: string }
  | { type: "failed"; error: ErrorInfo }
  | { type: "interrupted"; reason: "user" | "runner_restart" | "provider" };

export interface MapperOptions {
  sessionId: string;
  cwd: string;
  emit: (event: AgentEvent) => void;
  newId?: () => string;
}

/**
 * Stateful translator from Claude Agent SDK messages to normalized `AgentEvent`s. Pure with
 * respect to I/O: the session feeds it SDK messages and turn boundaries; it emits events.
 */
export class ClaudeEventMapper {
  readonly rootThreadId: string;
  private readonly emit: (event: AgentEvent) => void;
  private readonly newId: () => string;
  private rootTurnId: string | undefined;
  private messageId = "";
  private blocks = new Map<number, StreamBlock>();
  private readonly tools = new Map<string, ToolState>();
  private readonly todos = new Map<
    string,
    { id: string; turnId: string; todos: ItemOf<"todo_list">["todos"] }
  >();
  private readonly subagents: SubagentTracker;
  private contextTokens: number | undefined;
  private interruptRequested = false;
  private claudeSessionId: string | undefined;
  private model: string | undefined;

  constructor(private readonly opts: MapperOptions) {
    this.rootThreadId = `${opts.sessionId}:thread-root`;
    this.emit = opts.emit;
    this.newId = opts.newId ?? randomUUID;
    this.subagents = new SubagentTracker(opts.sessionId, this.emit, this.newId, (ctx, ok) =>
      this.finishThreadItems(ctx, ok),
    );
  }

  /** Complete open tool calls and the todo list of a thread whose turn is ending. */
  private finishThreadItems(ctx: ThreadCtx, ok: boolean): void {
    for (const [id, state] of this.tools) {
      if (state.ctx.turnId !== ctx.turnId) continue;
      if (state.item) this.item(ctx, "item.completed", { ...state.item, status: "cancelled" });
      if (state.special !== "subagent") this.tools.delete(id);
    }
    const todo = this.todos.get(ctx.threadId);
    if (todo && todo.turnId === ctx.turnId) {
      this.todos.delete(ctx.threadId);
      this.item(ctx, "item.completed", {
        id: todo.id,
        kind: "todo_list",
        status: ok ? "completed" : "cancelled",
        todos: todo.todos,
      });
    }
  }

  get turnId(): string | undefined {
    return this.rootTurnId;
  }

  get resumeToken(): string | undefined {
    return this.claudeSessionId;
  }

  /** Emit `thread.started` for the root thread (once, at session open). */
  start(resumeToken?: string): void {
    this.emit({ type: "thread.started", thread: { id: this.rootThreadId } });
    if (resumeToken) {
      this.claudeSessionId = resumeToken;
      this.emit({ type: "session.updated", resumeToken });
    }
  }

  /** Begin a root turn. Returns its id. */
  beginTurn(): string {
    if (this.rootTurnId) return this.rootTurnId;
    const turnId = this.newId();
    this.rootTurnId = turnId;
    this.emit({ type: "turn.started", threadId: this.rootThreadId, turnId });
    return turnId;
  }

  /** Root context for the current turn, starting an implicit turn if the CLI began one itself. */
  private rootCtx(): ThreadCtx {
    return { threadId: this.rootThreadId, turnId: this.beginTurn() };
  }

  /** Thread/turn of the thread a message belongs to (`parent_tool_use_id`). */
  private ctxFor(parentToolUseId: unknown): ThreadCtx {
    if (typeof parentToolUseId === "string" && parentToolUseId) {
      const child = this.subagents.ctx(parentToolUseId);
      if (child) return child;
    }
    return this.rootCtx();
  }

  /** Thread/turn of a tool call by its `tool_use` id (for approvals). */
  ctxForTool(toolUseId: string): ThreadCtx {
    return this.tools.get(toolUseId)?.ctx ?? this.rootCtx();
  }

  /** Emit an item event in a context. */
  item(
    ctx: ThreadCtx,
    phase: "item.started" | "item.updated" | "item.completed",
    item: Item,
  ): void {
    this.emit({ type: phase, threadId: ctx.threadId, turnId: ctx.turnId, item });
  }

  /** Feed one SDK message. */
  handle(message: unknown): void {
    const msg = message as Raw;
    switch (msg.type) {
      case "stream_event":
        if (!msg.parent_tool_use_id) this.onStreamEvent(msg.event as Raw);
        return;
      case "assistant":
        this.onAssistant(msg);
        return;
      case "user":
        this.onUser(msg);
        return;
      case "system":
        this.onSystem(msg);
        return;
      case "rate_limit_event": {
        const usage = usageFromRateLimit(msg);
        if (usage)
          this.emit({
            type: "usage.updated",
            threadId: this.rootThreadId,
            turnId: this.rootTurnId,
            usage,
          });
        return;
      }
      case "result":
        this.onResult(msg);
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------ streaming (root only)

  private onStreamEvent(event: Raw): void {
    const index = typeof event.index === "number" ? event.index : -1;
    switch (event.type) {
      case "message_start":
        this.messageId = str(event.message, "id") ?? this.newId();
        this.blocks = new Map();
        return;
      case "content_block_start": {
        const block = (event.content_block ?? {}) as Block;
        const ctx = this.rootCtx();
        if (block.type === "text" || block.type === "thinking") {
          const itemId = `${this.messageId}:${index}`;
          this.blocks.set(index, {
            itemId,
            type: block.type,
            text: "",
            consumed: false,
            completed: false,
          });
          const item: Item =
            block.type === "text"
              ? { id: itemId, kind: "assistant_message", status: "in_progress", text: "" }
              : { id: itemId, kind: "reasoning", status: "in_progress", text: "" };
          this.item(ctx, "item.started", item);
        } else if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          if (isSpecialTool(block.name)) return;
          const item = toolCallItem(block.id, block.name, {}, this.opts.cwd);
          this.tools.set(block.id, { ctx, item, startedAt: Date.now() });
          this.blocks.set(index, {
            itemId: block.id,
            type: "tool_use",
            text: "",
            consumed: false,
            completed: false,
          });
          this.item(ctx, "item.started", item);
        }
        return;
      }
      case "content_block_delta": {
        const sb = this.blocks.get(index);
        const delta = (event.delta ?? {}) as Raw;
        if (!sb || !this.rootTurnId) return;
        const base = {
          type: "item.delta" as const,
          threadId: this.rootThreadId,
          turnId: this.rootTurnId,
          itemId: sb.itemId,
        };
        if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
          sb.text += delta.text;
          this.emit({ ...base, delta: { type: "text", text: delta.text } });
        } else if (
          delta.type === "thinking_delta" &&
          typeof delta.thinking === "string" &&
          delta.thinking
        ) {
          sb.text += delta.thinking;
          this.emit({ ...base, delta: { type: "text", text: delta.thinking } });
        } else if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string" &&
          delta.partial_json
        ) {
          this.emit({ ...base, delta: { type: "tool_input", partialJson: delta.partial_json } });
        }
        return;
      }
      default:
        return;
    }
  }

  /** Find the streamed block an assistant message's content block corresponds to. */
  private claimStream(messageId: string, type: StreamBlock["type"]): StreamBlock | undefined {
    if (messageId !== this.messageId) return undefined;
    for (const sb of [...this.blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b)) {
      if (sb.type === type && !sb.consumed) {
        sb.consumed = true;
        return sb;
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------ full messages

  private onAssistant(msg: Raw): void {
    const message = (msg.message ?? {}) as Raw;
    const ctx = this.ctxFor(msg.parent_tool_use_id);
    const isRoot = !msg.parent_tool_use_id;
    const messageId = str(message, "id") ?? this.newId();
    if (isRoot) {
      const tokens = contextTokensFromMessageUsage(message.usage);
      if (tokens) this.contextTokens = tokens;
    }
    const content = Array.isArray(message.content) ? (message.content as Block[]) : [];
    for (const block of content) {
      if (
        block.type === "text" ||
        block.type === "thinking" ||
        block.type === "redacted_thinking"
      ) {
        const type = block.type === "text" ? "text" : "thinking";
        const sb = isRoot ? this.claimStream(messageId, type) : undefined;
        const id = sb?.itemId ?? `${messageId}:${this.newId().slice(0, 8)}`;
        if (sb) sb.completed = true;
        if (type === "text") {
          const text = str(block, "text") ?? sb?.text ?? "";
          this.item(ctx, "item.completed", {
            id,
            kind: "assistant_message",
            status: "completed",
            text,
          });
        } else {
          const text = str(block, "thinking") ?? "";
          this.item(ctx, "item.completed", {
            id,
            kind: "reasoning",
            status: "completed",
            text,
            ...(text ? {} : { redacted: true }),
          });
        }
      } else if (block.type === "tool_use" || block.type === "server_tool_use") {
        this.onToolUse(ctx, block, isRoot ? this.claimStream(messageId, "tool_use") : undefined);
      } else if (
        typeof block.type === "string" &&
        block.type.endsWith("_tool_result") &&
        typeof block.tool_use_id === "string"
      ) {
        this.onToolResult(
          block.tool_use_id,
          block.content,
          block.type.includes("error"),
          undefined,
        );
      }
    }
    const error = str(msg, "error");
    if (error && !msg.aborted) {
      const text = content
        .map((b) => str(b, "text") ?? "")
        .join("")
        .trim();
      this.item(ctx, "item.completed", {
        id: this.newId(),
        kind: "error",
        status: "completed",
        error: {
          code: error,
          message: text || `Claude reported an error: ${error}`,
          retryable: error === "rate_limit" || error === "overloaded" || error === "server_error",
        },
      });
    }
  }

  private onToolUse(ctx: ThreadCtx, block: Block, streamed: StreamBlock | undefined): void {
    const id = str(block, "id");
    let name = str(block, "name");
    if (!id || !name) return;
    if (block.type === "server_tool_use" && name === "web_search") name = "WebSearch";
    const input = (block.input && typeof block.input === "object" ? block.input : {}) as Raw;
    if (SUBAGENT_TOOLS.has(name)) {
      this.tools.set(id, { ctx, special: "subagent", startedAt: Date.now() });
      this.subagents.start(ctx, id, input);
      return;
    }
    if (name === TODO_TOOL) {
      this.tools.set(id, { ctx, special: "todo", startedAt: Date.now() });
      this.updateTodos(ctx, input.todos);
      return;
    }
    if (name === QUESTION_TOOL) {
      this.tools.set(id, { ctx, special: "question", startedAt: Date.now() });
      return;
    }
    if (name === PLAN_TOOL) {
      this.tools.set(id, { ctx, special: "plan", startedAt: Date.now() });
      const plan = str(input, "plan");
      if (plan)
        this.item(ctx, "item.completed", {
          id: `plan-${id}`,
          kind: "plan",
          status: "completed",
          text: plan,
        });
      return;
    }
    const item = toolCallItem(id, name, input, this.opts.cwd);
    const existing = this.tools.get(id);
    this.tools.set(id, { ctx, item, startedAt: existing?.startedAt ?? Date.now() });
    this.item(ctx, streamed || existing ? "item.updated" : "item.started", item);
  }

  private updateTodos(ctx: ThreadCtx, raw: unknown): void {
    const list = Array.isArray(raw) ? raw : [];
    const todos = list.map((t, i) => ({
      id: String(i + 1),
      text: str(t, "content") ?? str(t, "activeForm") ?? "",
      status: (["pending", "in_progress", "completed"].includes(str(t, "status") ?? "")
        ? str(t, "status")
        : "pending") as "pending" | "in_progress" | "completed",
    }));
    const existing = this.todos.get(ctx.threadId);
    if (existing && existing.turnId === ctx.turnId) {
      existing.todos = todos;
      this.item(ctx, "item.updated", {
        id: existing.id,
        kind: "todo_list",
        status: "in_progress",
        todos,
      });
    } else {
      const id = `todos-${this.newId()}`;
      this.todos.set(ctx.threadId, { id, turnId: ctx.turnId, todos });
      this.item(ctx, "item.started", { id, kind: "todo_list", status: "in_progress", todos });
    }
  }

  private onUser(msg: Raw): void {
    const message = (msg.message ?? {}) as Raw;
    if (!Array.isArray(message.content)) return;
    for (const block of message.content as Block[]) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        this.onToolResult(
          block.tool_use_id,
          block.content,
          block.is_error === true,
          msg.tool_use_result,
        );
      }
    }
  }

  private onToolResult(
    toolUseId: string,
    content: unknown,
    isError: boolean,
    toolUseResult: unknown,
  ): void {
    const state = this.tools.get(toolUseId);
    if (!state) return;
    if (state.special === "subagent") {
      this.subagents.onToolResult(toolUseId, content, isError, toolUseResult);
      this.tools.delete(toolUseId);
      return;
    }
    if (state.special || !state.item) {
      this.tools.delete(toolUseId);
      return;
    }
    const done = completeToolCall(state.item, {
      content,
      isError,
      toolUseResult,
      durationMs: Date.now() - state.startedAt,
    });
    this.tools.delete(toolUseId);
    this.item(state.ctx, "item.completed", done);
  }

  private onSystem(msg: Raw): void {
    switch (msg.subtype) {
      case "init": {
        const sessionId = str(msg, "session_id");
        const model = str(msg, "model");
        if (sessionId !== this.claudeSessionId || model !== this.model) {
          this.claudeSessionId = sessionId ?? this.claudeSessionId;
          this.model = model ?? this.model;
          this.emit({
            type: "session.updated",
            resumeToken: this.claudeSessionId,
            model: this.model,
          });
        }
        return;
      }
      case "task_started":
        this.subagents.onTaskStarted(msg);
        return;
      case "task_notification":
        this.subagents.onTaskNotification(msg);
        return;
      case "compact_boundary":
        this.item(this.rootCtx(), "item.completed", {
          id: this.newId(),
          kind: "notice",
          status: "completed",
          level: "info",
          code: "context_compacted",
          message: "Context compacted",
        });
        return;
      default:
        return;
    }
  }

  /** The user pressed stop: the next `result` ends the turn as interrupted. */
  requestInterrupt(): void {
    if (this.rootTurnId) this.interruptRequested = true;
  }

  private onResult(msg: Raw): void {
    if (!this.rootTurnId) return;
    this.emit({
      type: "usage.updated",
      threadId: this.rootThreadId,
      turnId: this.rootTurnId,
      usage: usageFromResult(msg, this.contextTokens),
    });
    if (this.interruptRequested) {
      this.endTurn({ type: "interrupted", reason: "user" });
      return;
    }
    if (typeof msg.queued_turn_count === "number" && msg.queued_turn_count > 0) return;
    const subtype = str(msg, "subtype");
    if (subtype === "success" && msg.is_error !== true) {
      this.endTurn({ type: "completed", stopReason: str(msg, "stop_reason") ?? "end_turn" });
      return;
    }
    const errors = Array.isArray(msg.errors)
      ? (msg.errors as unknown[]).filter((e) => typeof e === "string")
      : [];
    const message =
      errors.join("\n") || str(msg, "result") || `Claude turn ended with ${subtype ?? "an error"}`;
    this.endTurn({
      type: "failed",
      error: { code: subtype ?? "error", message, retryable: subtype === "error_during_execution" },
    });
  }

  /** Close the root turn: finish dangling items and emit the terminal turn event. */
  endTurn(outcome: TurnOutcome): void {
    const turnId = this.rootTurnId;
    if (!turnId) return;
    const ctx = { threadId: this.rootThreadId, turnId };
    const finished = outcome.type === "completed" ? "completed" : "cancelled";
    for (const sb of this.blocks.values()) {
      if (sb.completed || sb.type === "tool_use") continue;
      sb.completed = true;
      this.item(
        ctx,
        "item.completed",
        sb.type === "text"
          ? { id: sb.itemId, kind: "assistant_message", status: finished, text: sb.text }
          : {
              id: sb.itemId,
              kind: "reasoning",
              status: finished,
              text: sb.text,
              ...(sb.text ? {} : { redacted: true }),
            },
      );
    }
    this.blocks = new Map();
    if (outcome.type !== "completed") this.subagents.interruptForeground(turnId);
    this.finishThreadItems(ctx, outcome.type === "completed");
    this.rootTurnId = undefined;
    this.interruptRequested = false;
    if (outcome.type === "completed") {
      this.emit({ type: "turn.completed", ...ctx, stopReason: outcome.stopReason });
    } else if (outcome.type === "failed") {
      this.emit({ type: "turn.failed", ...ctx, error: outcome.error });
    } else {
      this.emit({ type: "turn.interrupted", ...ctx, reason: outcome.reason });
    }
  }

  /** Session closing: end any still-running subagent threads. */
  closeAll(): void {
    if (this.rootTurnId) this.endTurn({ type: "interrupted", reason: "user" });
    this.subagents.interruptAll();
  }
}
