import { randomUUID } from "node:crypto";
import type { AgentEvent, ErrorInfo, Item, Usage } from "@codeden/contracts";
import { str } from "../util/text";
import { StreamAssembler } from "./stream";
import { SubagentTracker, type ThreadCtx } from "./subagents";
import { ToolTracker } from "./tool-tracker";
import {
  contextTokensFromMessageUsage,
  turnDelta,
  usageFromRateLimit,
  usageFromResult,
} from "./usage";

type Raw = Record<string, unknown>;
type Block = Raw & { type?: string };

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
 * Root-thread text and tool input stream through `stream_event`s; the full `assistant`
 * message that follows completes the item.
 */
export class ClaudeEventMapper {
  readonly rootThreadId: string;
  private readonly emit: (event: AgentEvent) => void;
  private readonly newId: () => string;
  private readonly subagents: SubagentTracker;
  private readonly tools: ToolTracker;
  private rootTurnId: string | undefined;
  private readonly stream: StreamAssembler;
  private contextTokens: number | undefined;
  private interruptRequested = false;
  private claudeSessionId: string | undefined;
  private model: string | undefined;
  /** Running usage total of this query (process), from the latest `result`. */
  private queryTotal: Usage | undefined;
  /** `queryTotal` when the current root turn began. */
  private turnBaseline: Usage | undefined;

  constructor(opts: MapperOptions) {
    this.rootThreadId = `${opts.sessionId}:thread-root`;
    this.emit = opts.emit;
    this.newId = opts.newId ?? randomUUID;
    this.subagents = new SubagentTracker(opts.sessionId, this.emit, this.newId, (ctx, ok) =>
      this.tools.finishTurn(ctx, ok),
    );
    this.tools = new ToolTracker(
      opts.cwd,
      (ctx, phase, item) => this.item(ctx, phase, item),
      this.subagents,
      this.newId,
    );
    this.stream = new StreamAssembler({
      rootCtx: () => this.rootCtx(),
      emit: this.emit,
      item: (ctx, phase, item) => this.item(ctx, phase, item),
      tools: this.tools,
      newId: this.newId,
    });
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

  /** Begin a root turn (no-op if one is running). Returns its id. */
  beginTurn(): string {
    if (this.rootTurnId) return this.rootTurnId;
    const turnId = this.newId();
    this.rootTurnId = turnId;
    this.turnBaseline = this.queryTotal;
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
    return this.tools.ctx(toolUseId) ?? this.rootCtx();
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
        if (!msg.parent_tool_use_id) this.stream.onEvent(msg.event as Raw);
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
        if (usage) {
          this.emit({
            type: "usage.updated",
            threadId: this.rootThreadId,
            turnId: this.rootTurnId,
            usage,
          });
        }
        return;
      }
      case "result":
        this.onResult(msg);
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------ full messages

  private onAssistant(msg: Raw): void {
    const message = (msg.message ?? {}) as Raw;
    const ctx = this.ctxFor(msg.parent_tool_use_id);
    const isRoot = !msg.parent_tool_use_id;
    const messageId = str(message, "id") ?? this.newId();
    if (isRoot)
      this.contextTokens = contextTokensFromMessageUsage(message.usage) ?? this.contextTokens;
    const content = Array.isArray(message.content) ? (message.content as Block[]) : [];
    for (const block of content) {
      if (
        block.type === "text" ||
        block.type === "thinking" ||
        block.type === "redacted_thinking"
      ) {
        const type = block.type === "text" ? "text" : "thinking";
        const sb = isRoot ? this.stream.claim(messageId, type) : undefined;
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
        if (isRoot) this.stream.claim(messageId, "tool_use");
        const id = str(block, "id");
        const raw = str(block, "name");
        const name = block.type === "server_tool_use" && raw === "web_search" ? "WebSearch" : raw;
        const input = (block.input && typeof block.input === "object" ? block.input : {}) as Raw;
        if (id && name) this.tools.onToolUse(ctx, id, name, input);
      } else if (
        typeof block.type === "string" &&
        block.type.endsWith("_tool_result") &&
        typeof block.tool_use_id === "string"
      ) {
        this.tools.onToolResult(
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

  private onUser(msg: Raw): void {
    const message = (msg.message ?? {}) as Raw;
    if (!Array.isArray(message.content)) return;
    for (const block of message.content as Block[]) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        this.tools.onToolResult(
          block.tool_use_id,
          block.content,
          block.is_error === true,
          msg.tool_use_result,
        );
      }
    }
  }

  private onSystem(msg: Raw): void {
    if (msg.subtype === "init") {
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
    } else if (msg.subtype === "task_started") {
      this.subagents.onTaskStarted(msg);
    } else if (msg.subtype === "task_notification") {
      this.subagents.onTaskNotification(msg);
    } else if (msg.subtype === "compact_boundary") {
      this.item(this.rootCtx(), "item.completed", {
        id: this.newId(),
        kind: "notice",
        status: "completed",
        level: "info",
        code: "context_compacted",
        message: "Context compacted",
      });
    }
  }

  /** The user pressed stop: the next `result` ends the turn as interrupted. */
  requestInterrupt(): void {
    if (this.rootTurnId) this.interruptRequested = true;
  }

  private onResult(msg: Raw): void {
    if (!this.rootTurnId) return;
    // `result` carries running totals for the whole query; report this turn's own share.
    const total = usageFromResult(msg, this.contextTokens);
    this.queryTotal = total;
    this.emit({
      type: "usage.updated",
      threadId: this.rootThreadId,
      turnId: this.rootTurnId,
      usage: turnDelta(total, this.turnBaseline),
    });
    if (this.interruptRequested) {
      this.endTurn({ type: "interrupted", reason: "user" });
      return;
    }
    // Queued (steered) input that ran as its own CLI turn still belongs to this CodeDen turn.
    if (typeof msg.queued_turn_count === "number" && msg.queued_turn_count > 0) return;
    const subtype = str(msg, "subtype");
    if (subtype === "success" && msg.is_error !== true) {
      this.endTurn({ type: "completed", stopReason: str(msg, "stop_reason") ?? "end_turn" });
      return;
    }
    const errors = Array.isArray(msg.errors) ? msg.errors.filter((e) => typeof e === "string") : [];
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
    const status = outcome.type === "completed" ? "completed" : "cancelled";
    this.stream.finish(status, (item) => this.item(ctx, "item.completed", item));
    if (outcome.type !== "completed") this.subagents.interruptForeground(turnId);
    this.tools.finishTurn(ctx, outcome.type === "completed");
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

  /** Session closing: end the running turn and any still-running subagent threads. */
  closeAll(): void {
    if (this.rootTurnId) this.endTurn({ type: "interrupted", reason: "user" });
    this.subagents.interruptAll();
  }
}
