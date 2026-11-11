import type { AgentEvent, FileChange, Item, ItemOf, ToolCallItem, Usage } from "@codeden/contracts";
import { count, shorten, toJson, toolOutput } from "../util/text";
import { type ClassifiedError, classifyOpencodeError, isAbortError } from "./errors";
import type {
  OcError,
  OcEvent,
  OcReasoningPart,
  OcStepFinishPart,
  OcTextPart,
  OcTodo,
  OcToolPart,
} from "./types";

type Todo = ItemOf<"todo_list">["todos"][number];
type Outcome =
  | { type: "completed" }
  | { type: "interrupted" }
  | ({ type: "failed" } & ClassifiedError);

const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "patch", "apply_patch"]);
const SEARCH_TOOLS = new Set(["grep", "glob", "list", "codesearch", "lsp"]);

/** opencode names MCP tools `<server>_<tool>`, with non-word characters as `_`. */
function mcpPrefix(server: string): string {
  return `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}_`;
}

export interface OpencodeMapperOptions {
  /**
   * The session's MCP servers, to recognise their tools: plain names, or `{ name, server }`
   * where `name` is what opencode registered (per session) and `server` the name to show.
   */
  mcpServers?: readonly (string | { name: string; server: string })[];
  /** Context window of a CodeBench model id (`provider/model`), for the context meter. */
  contextWindow?: (model: string) => number | undefined;
}

/**
 * Translates opencode server events for one opencode session into normalized `AgentEvent`s.
 * A CodeBench turn is one prompt: from `beginTurn` (on send) to `session.idle`. opencode part
 * ids are used as item ids (they are unique per session).
 */
export class OpencodeEventMapper {
  readonly rootThreadId: string;
  /** opencode session id (also the resume token). */
  opencodeSessionId: string | undefined;
  private turnId: string | undefined;
  private turnCount = 0;
  private readonly userMessages = new Set<string>();
  private readonly open = new Map<string, Item>();
  private readonly toolOutputSent = new Map<string, number>();
  private readonly callToItem = new Map<string, string>();
  private todos: { id: string; todos: Todo[] } | undefined;
  private turnError: OcError | undefined;
  private aborted = false;
  private usage = emptyUsage();
  private model: string | undefined;

  constructor(
    sessionId: string,
    private readonly emit: (event: AgentEvent) => void,
    private readonly options: OpencodeMapperOptions = {},
  ) {
    this.rootThreadId = `${sessionId}:thread-root`;
  }

  get currentTurnId(): string | undefined {
    return this.turnId;
  }

  /** The tool call item for an opencode `callID` (permission requests name the call). */
  itemForCall(callID: string | undefined): string | undefined {
    return callID ? this.callToItem.get(callID) : undefined;
  }

  /** Start a new turn; returns its id. An open turn is closed as interrupted first. */
  beginTurn(): string {
    if (this.turnId) this.endTurn({ type: "interrupted" });
    this.turnCount += 1;
    const id = `turn-${this.turnCount}-${Date.now().toString(36)}`;
    this.turnId = id;
    this.turnError = undefined;
    this.aborted = false;
    this.usage = emptyUsage();
    this.emit({ type: "turn.started", ...this.ctx(id) });
    return id;
  }

  /** Mark the running turn as aborted by the user; `session.idle` then closes it. */
  markAborted(): void {
    if (this.turnId) this.aborted = true;
  }

  private ctx(turnId: string): { threadId: string; turnId: string } {
    return { threadId: this.rootThreadId, turnId };
  }

  handle(event: OcEvent): void {
    const p = event.properties as { sessionID?: string };
    if (p?.sessionID && this.opencodeSessionId && p.sessionID !== this.opencodeSessionId) return;
    switch (event.type) {
      case "message.updated": {
        const info = event.properties.info;
        if (info.role === "user") {
          this.userMessages.add(info.id);
          return;
        }
        if (info.providerID && info.modelID) {
          const model = `${info.providerID}/${info.modelID}`;
          if (model !== this.model) {
            this.model = model;
            this.emit({ type: "session.updated", model });
          }
        }
        if (info.error && this.turnId) {
          if (isAbortError(info.error)) this.aborted = true;
          else this.turnError = info.error;
        }
        return;
      }
      case "message.part.updated": {
        const part = event.properties.part;
        if (!this.turnId || this.userMessages.has(part.messageID)) return;
        if (part.type === "text") this.text(part as OcTextPart, "assistant_message");
        else if (part.type === "reasoning") this.text(part as OcReasoningPart, "reasoning");
        else if (part.type === "tool") this.tool(part as OcToolPart);
        else if (part.type === "step-finish") this.step(part as OcStepFinishPart);
        return;
      }
      case "message.part.delta": {
        const { partID, field, delta } = event.properties;
        const turnId = this.turnId;
        const item = this.open.get(partID);
        if (!turnId || !item || field !== "text" || !delta) return;
        if (item.kind !== "assistant_message" && item.kind !== "reasoning") return;
        item.text += delta;
        this.emit({
          type: "item.delta",
          ...this.ctx(turnId),
          itemId: partID,
          delta: { type: "text", text: delta },
        });
        return;
      }
      case "session.status": {
        const status = event.properties.status;
        if (status.type === "retry" && this.turnId) {
          this.notice("warning", `${status.message} (retry ${status.attempt})`, "retrying");
        }
        return;
      }
      case "session.error": {
        const error = event.properties.error;
        if (!this.turnId || !error) return;
        if (isAbortError(error)) this.aborted = true;
        else this.turnError = error;
        return;
      }
      case "session.compacted":
        if (this.turnId) this.notice("info", "Context compacted", "context_compacted");
        return;
      case "todo.updated":
        this.updateTodos(event.properties.todos);
        return;
      case "session.idle":
        this.finishTurn();
        return;
      default:
        return;
    }
  }

  /** `session.idle`: the prompt is done; close the turn by what happened in it. */
  private finishTurn(): void {
    if (!this.turnId) return;
    if (this.aborted) this.endTurn({ type: "interrupted" });
    else if (this.turnError)
      this.endTurn({ type: "failed", ...classifyOpencodeError(this.turnError) });
    else this.endTurn({ type: "completed" });
  }

  private text(part: OcTextPart | OcReasoningPart, kind: "assistant_message" | "reasoning"): void {
    const turnId = this.turnId;
    if (!turnId) return;
    if (part.type === "text" && (part.synthetic || part.ignored)) return;
    const done = part.time?.end !== undefined;
    const item: Item =
      kind === "assistant_message"
        ? { id: part.id, kind, status: done ? "completed" : "in_progress", text: part.text ?? "" }
        : { id: part.id, kind, status: done ? "completed" : "in_progress", text: part.text ?? "" };
    if (done) {
      this.open.delete(part.id);
      // Reasoning that streamed nothing visible is not worth a transcript entry.
      if (kind === "reasoning" && !item.text.trim()) {
        this.emit({
          type: "item.completed",
          ...this.ctx(turnId),
          item: { ...item, redacted: true } as Item,
        });
        return;
      }
      this.emit({ type: "item.completed", ...this.ctx(turnId), item });
      return;
    }
    if (this.open.has(part.id)) return;
    this.open.set(part.id, item);
    this.emit({ type: "item.started", ...this.ctx(turnId), item });
  }

  private tool(part: OcToolPart): void {
    const turnId = this.turnId;
    if (!turnId) return;
    this.callToItem.set(part.callID, part.id);
    const item = this.toolItem(part);
    const state = part.state;
    if (state.status === "completed" || state.status === "error") {
      this.open.delete(part.id);
      this.toolOutputSent.delete(part.id);
      this.emit({ type: "item.completed", ...this.ctx(turnId), item });
      return;
    }
    const known = this.open.has(part.id);
    this.open.set(part.id, item);
    if (!known) {
      this.emit({ type: "item.started", ...this.ctx(turnId), item });
    } else if (state.status === "running") {
      // Live output (bash streams `metadata.output`); send only what is new.
      const live = typeof state.metadata?.output === "string" ? state.metadata.output : undefined;
      const sent = this.toolOutputSent.get(part.id) ?? 0;
      if (live !== undefined && live.length > sent) {
        this.toolOutputSent.set(part.id, live.length);
        this.emit({
          type: "item.delta",
          ...this.ctx(turnId),
          itemId: part.id,
          delta: { type: "tool_output", text: live.slice(sent) },
        });
      } else {
        this.emit({ type: "item.updated", ...this.ctx(turnId), item });
      }
    }
  }

  /** opencode tool part -> CodeBench tool call item. */
  toolItem(part: OcToolPart): ToolCallItem {
    const state = part.state;
    const input = (state.input ?? {}) as Record<string, unknown>;
    const meta = ("metadata" in state ? state.metadata : undefined) ?? {};
    const status: ToolCallItem["status"] =
      state.status === "completed"
        ? "completed"
        : state.status === "error"
          ? "failed"
          : "in_progress";
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const base = {
      id: part.id,
      kind: "tool_call" as const,
      status,
      toolName: part.tool,
      ...(s("title" in state ? state.title : undefined)
        ? { title: shorten(s((state as { title?: string }).title) ?? "", 120) }
        : {}),
      input: toJson(input),
      ...(state.status === "completed" ? { output: toolOutput(state.output ?? "") } : {}),
      ...(state.status === "error" ? { error: { message: state.error } } : {}),
      ...(state.status === "completed" || state.status === "error"
        ? { durationMs: Math.max(0, state.time.end - state.time.start) }
        : {}),
    };
    const tool = part.tool.toLowerCase();
    if (tool === "bash" || tool === "shell") {
      const exit = typeof meta.exit === "number" ? meta.exit : undefined;
      return {
        ...base,
        toolKind: "command",
        command: s(input.command) ?? "",
        ...(s(input.workdir) ? { cwd: s(input.workdir) } : {}),
        ...(exit !== undefined ? { exitCode: exit } : {}),
        title:
          base.title ?? shorten(s(input.description) ?? s(input.command) ?? "Run command", 120),
      };
    }
    if (EDIT_TOOLS.has(tool)) {
      return { ...base, toolKind: "file_edit", changes: fileChanges(tool, input, meta) };
    }
    if (tool === "read") {
      const offset = typeof input.offset === "number" ? input.offset : undefined;
      const limit = typeof input.limit === "number" ? input.limit : undefined;
      return {
        ...base,
        toolKind: "file_read",
        path: s(input.filePath) ?? s(input.path) ?? "",
        ...(offset !== undefined && offset >= 1 ? { startLine: Math.round(offset) } : {}),
        ...(offset !== undefined && limit !== undefined && offset >= 1 && limit >= 1
          ? { endLine: Math.round(offset + limit - 1) }
          : {}),
      };
    }
    if (SEARCH_TOOLS.has(tool)) {
      const matches = count(meta.matches) ?? count(meta.count);
      return {
        ...base,
        toolKind: "search",
        query: s(input.pattern) ?? s(input.query) ?? s(input.path) ?? "",
        ...(s(input.path) ? { path: s(input.path) } : {}),
        ...(matches !== undefined ? { matchCount: matches } : {}),
      };
    }
    if (tool === "webfetch")
      return { ...base, toolKind: "web", ...(s(input.url) ? { url: s(input.url) } : {}) };
    if (tool === "websearch") {
      return { ...base, toolKind: "web", ...(s(input.query) ? { query: s(input.query) } : {}) };
    }
    for (const entry of this.options.mcpServers ?? []) {
      const { name, server } = typeof entry === "string" ? { name: entry, server: entry } : entry;
      const prefix = mcpPrefix(name);
      if (part.tool.startsWith(prefix) && part.tool.length > prefix.length) {
        return { ...base, toolKind: "mcp", server, tool: part.tool.slice(prefix.length) };
      }
    }
    return { ...base, toolKind: "other" };
  }

  /** `step-finish`: one model call. Usage is the turn's own total so far. */
  private step(part: OcStepFinishPart): void {
    const turnId = this.turnId;
    if (!turnId) return;
    const t = part.tokens;
    const u = this.usage;
    u.inputTokens += t.input ?? 0;
    u.outputTokens += (t.output ?? 0) + (t.reasoning ?? 0);
    u.reasoningTokens += t.reasoning ?? 0;
    u.cachedInputTokens += t.cache?.read ?? 0;
    u.cacheWriteTokens += t.cache?.write ?? 0;
    u.costUsd += part.cost ?? 0;
    const context =
      (t.input ?? 0) +
      (t.cache?.read ?? 0) +
      (t.cache?.write ?? 0) +
      (t.output ?? 0) +
      (t.reasoning ?? 0);
    const usage: Usage = {
      inputTokens: count(u.inputTokens),
      outputTokens: count(u.outputTokens),
      reasoningTokens: count(u.reasoningTokens),
      cachedInputTokens: count(u.cachedInputTokens),
      cacheWriteTokens: count(u.cacheWriteTokens),
      contextTokens: count(context),
      // opencode prices every call from its model table (0 on subscription plans such as Z.AI's).
      costUsd: Math.round(u.costUsd * 1e9) / 1e9,
    };
    const window = this.model ? this.options.contextWindow?.(this.model) : undefined;
    if (window && window > 0) usage.contextWindow = Math.round(window);
    this.emit({ type: "usage.updated", ...this.ctx(turnId), usage });
  }

  private updateTodos(list: OcTodo[]): void {
    const turnId = this.turnId;
    if (!turnId) return;
    const todos: Todo[] = list.map((t, i) => ({
      id: t.id ?? String(i + 1),
      text: t.content,
      status:
        t.status === "in_progress"
          ? "in_progress"
          : t.status === "completed" || t.status === "cancelled"
            ? "completed"
            : "pending",
    }));
    if (this.todos) {
      this.todos.todos = todos;
      this.emit({
        type: "item.updated",
        ...this.ctx(turnId),
        item: { id: this.todos.id, kind: "todo_list", status: "in_progress", todos },
      });
    } else {
      this.todos = { id: `todos-${turnId}`, todos };
      this.emit({
        type: "item.started",
        ...this.ctx(turnId),
        item: { id: this.todos.id, kind: "todo_list", status: "in_progress", todos },
      });
    }
  }

  private notice(level: "info" | "warning", message: string, code: string): void {
    const turnId = this.turnId;
    if (!turnId) return;
    this.emit({
      type: "item.completed",
      ...this.ctx(turnId),
      item: {
        id: `${code}-${turnId}-${Date.now().toString(36)}`,
        kind: "notice",
        status: "completed",
        level,
        code,
        message,
      },
    });
  }

  /** Close the current turn (also used on interrupt deadlines and server exits). */
  endTurn(outcome: Outcome): void {
    const turnId = this.turnId;
    if (!turnId) return;
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
    this.toolOutputSent.clear();
    if (this.todos) {
      this.emit({
        type: "item.completed",
        ...ctx,
        item: {
          id: this.todos.id,
          kind: "todo_list",
          status: ok ? "completed" : "cancelled",
          todos: this.todos.todos,
        },
      });
      this.todos = undefined;
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
          code: outcome.code,
          message: outcome.message,
          ...(outcome.detail ? { detail: outcome.detail } : {}),
          kind: outcome.kind,
          retryable: outcome.kind === "transient" || outcome.kind === "usage_limit",
        },
      });
    }
  }
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

/** Lines added and removed in a unified diff. */
function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

/** The file changes of an edit/write/patch tool call, as far as opencode reports them. */
function fileChanges(
  tool: string,
  input: Record<string, unknown>,
  meta: Record<string, unknown>,
): FileChange[] {
  const diff = typeof meta.diff === "string" ? meta.diff : undefined;
  const stats = diff ? diffStats(diff) : undefined;
  const path =
    (typeof input.filePath === "string" && input.filePath) ||
    (typeof meta.filepath === "string" && meta.filepath) ||
    (typeof input.path === "string" && input.path) ||
    undefined;
  if (path) {
    const change: FileChange["change"] =
      tool === "write" && meta.exists === false ? "add" : "modify";
    return [{ path, change, ...(diff ? { diff } : {}), ...(stats ?? {}) }];
  }
  // apply_patch / patch: opencode lists the touched files in metadata.
  const files = Array.isArray(meta.files) ? meta.files : [];
  return files.flatMap((f): FileChange[] => {
    if (typeof f === "string") return [{ path: f, change: "modify" }];
    if (f && typeof f === "object") {
      const r = f as Record<string, unknown>;
      const p =
        (typeof r.filePath === "string" && r.filePath) || (typeof r.path === "string" && r.path);
      if (!p) return [];
      const kind = r.type === "add" || r.type === "delete" ? r.type : "modify";
      return [{ path: p, change: kind }];
    }
    return [];
  });
}
