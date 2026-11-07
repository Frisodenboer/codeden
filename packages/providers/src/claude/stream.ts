import type { AgentEvent, Item, ItemStatus } from "@codeden/contracts";
import { str } from "../util/text";
import type { ThreadCtx } from "./subagents";
import type { ToolTracker } from "./tool-tracker";
import { isSpecialTool } from "./tools";

type Raw = Record<string, unknown>;

/** A content block streaming in through `stream_event`s. */
export interface StreamBlock {
  itemId: string;
  type: "text" | "thinking" | "tool_use";
  text: string;
  /** Matched to a content block of a full `assistant` message. */
  consumed: boolean;
  completed: boolean;
}

export interface StreamDeps {
  /** Root thread context, opening an implicit turn if needed. */
  rootCtx: () => ThreadCtx;
  emit: (event: AgentEvent) => void;
  item: (ctx: ThreadCtx, phase: "item.started", item: Item) => void;
  tools: ToolTracker;
  newId: () => string;
}

/**
 * Assembles root-thread `stream_event`s (text, thinking and tool-input deltas) into started
 * items. The full `assistant` message that follows each block completes it via `claim()`.
 */
export class StreamAssembler {
  private messageId = "";
  private blocks = new Map<number, StreamBlock>();

  constructor(private readonly deps: StreamDeps) {}

  onEvent(event: Raw): void {
    const index = typeof event.index === "number" ? event.index : -1;
    if (event.type === "message_start") {
      this.messageId = str(event.message, "id") ?? this.deps.newId();
      this.blocks = new Map();
    } else if (event.type === "content_block_start") {
      const block = (event.content_block ?? {}) as Raw;
      const ctx = this.deps.rootCtx();
      const fresh = { text: "", consumed: false, completed: false };
      if (block.type === "text" || block.type === "thinking") {
        const itemId = `${this.messageId}:${index}`;
        this.blocks.set(index, { itemId, type: block.type, ...fresh });
        this.deps.item(
          ctx,
          "item.started",
          block.type === "text"
            ? { id: itemId, kind: "assistant_message", status: "in_progress", text: "" }
            : { id: itemId, kind: "reasoning", status: "in_progress", text: "" },
        );
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        if (isSpecialTool(block.name)) return;
        this.blocks.set(index, { itemId: block.id, type: "tool_use", ...fresh });
        this.deps.tools.startStreamed(ctx, block.id, block.name);
      }
    } else if (event.type === "content_block_delta") {
      this.onDelta(this.blocks.get(index), (event.delta ?? {}) as Raw);
    }
  }

  private onDelta(sb: StreamBlock | undefined, delta: Raw): void {
    if (!sb) return;
    const ctx = this.deps.rootCtx();
    const base = { type: "item.delta" as const, ...ctx, itemId: sb.itemId };
    const text =
      delta.type === "text_delta"
        ? delta.text
        : delta.type === "thinking_delta"
          ? delta.thinking
          : undefined;
    if (typeof text === "string" && text) {
      sb.text += text;
      this.deps.emit({ ...base, delta: { type: "text", text } });
    } else if (
      delta.type === "input_json_delta" &&
      typeof delta.partial_json === "string" &&
      delta.partial_json
    ) {
      this.deps.emit({ ...base, delta: { type: "tool_input", partialJson: delta.partial_json } });
    }
  }

  /** The streamed block a full assistant message's content block corresponds to. */
  claim(messageId: string, type: StreamBlock["type"]): StreamBlock | undefined {
    if (messageId !== this.messageId) return undefined;
    const ordered = [...this.blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
    const sb = ordered.find((b) => b.type === type && !b.consumed);
    if (sb) sb.consumed = true;
    return sb;
  }

  /** Turn ending: complete text/thinking blocks that never got their full message. */
  finish(status: ItemStatus, emitItem: (item: Item) => void): void {
    for (const sb of this.blocks.values()) {
      if (sb.completed || sb.type === "tool_use") continue;
      sb.completed = true;
      emitItem(
        sb.type === "text"
          ? { id: sb.itemId, kind: "assistant_message", status, text: sb.text }
          : {
              id: sb.itemId,
              kind: "reasoning",
              status,
              text: sb.text,
              ...(sb.text ? {} : { redacted: true }),
            },
      );
    }
    this.blocks = new Map();
  }
}
