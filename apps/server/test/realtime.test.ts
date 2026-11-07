import type { AgentEvent, RawEventEnvelope } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { coalesceEvents } from "../src/realtime/coalesce";
import { collectDirty, emptyDirty } from "../src/realtime/transcript";
import { previewRecord } from "../src/services/sessions/preview";

let seq = 0;
const env = (event: AgentEvent, sessionId = "s1"): RawEventEnvelope => ({
  seq: ++seq,
  sessionId,
  type: `agent.${event.type}`,
  payload: event,
  ts: "2026-11-07T10:00:00.000Z",
});
const text = (itemId: string, t: string, type: "text" | "tool_output" = "text"): AgentEvent => ({
  type: "item.delta",
  threadId: "t",
  turnId: "u",
  itemId,
  delta: type === "text" ? { type, text: t } : { type, text: t, stream: "stdout" },
});

describe("coalesceEvents", () => {
  it("merges consecutive text deltas of one item, keeping the last seq", () => {
    const events = [
      env(text("a", "He")),
      env(text("a", "llo")),
      env(text("b", "!")),
      env(text("a", "?")),
    ];
    const out = coalesceEvents(events);
    expect(out.map((e) => (e.payload as { delta: { text: string } }).delta.text)).toEqual([
      "Hello",
      "!",
      "?",
    ]);
    expect(out[0]?.seq).toBe(events[1]?.seq);
  });

  it("does not merge across delta types, streams, sessions or other events", () => {
    const events = [
      env(text("a", "x")),
      env(text("a", "y", "tool_output")),
      env(text("a", "z"), "s2"),
      env({ type: "turn.completed", threadId: "t", turnId: "u" }),
      env(text("a", "w")),
    ];
    expect(coalesceEvents(events)).toHaveLength(5);
  });
});

describe("collectDirty", () => {
  it("tracks touched rows per session and thread filter", () => {
    const events = [
      env({ type: "thread.started", thread: { id: "child", parentThreadId: "t" } }),
      env({ type: "turn.started", threadId: "t", turnId: "u" }),
      env({
        type: "item.started",
        threadId: "t",
        turnId: "u",
        item: { id: "i", kind: "plan", status: "in_progress", text: "" },
      }),
      env(text("i", "x")),
      env({ type: "turn.started", threadId: "other", turnId: "u2" }),
      env({ type: "usage.updated", threadId: "t", usage: {} }),
      env({ type: "turn.started", threadId: "t", turnId: "elsewhere" }, "s2"),
    ];
    const dirty = emptyDirty();
    collectDirty(dirty, events, "s1", new Set(["t"]));
    expect([...dirty.threads]).toEqual(["child"]);
    expect([...dirty.turns]).toEqual(["u"]);
    expect([...dirty.items]).toEqual(["i"]);
    expect(dirty.usage).toBe(true);
    expect(dirty.seq).toBe(events[5]?.seq);
  });
});

describe("previewRecord", () => {
  it("keeps the tail of large tool outputs and marks them truncated", () => {
    const record = {
      sessionId: "s",
      threadId: "t",
      turnId: "u",
      position: 0,
      createdAt: "2026-11-07T10:00:00.000Z",
      updatedAt: "2026-11-07T10:00:00.000Z",
      item: {
        id: "c",
        kind: "tool_call" as const,
        toolKind: "command" as const,
        status: "completed" as const,
        toolName: "shell",
        command: "yes",
        output: { text: `${"a".repeat(50)}END`, truncated: false },
      },
    };
    const preview = previewRecord(record, 10);
    const output = preview.item.kind === "tool_call" ? preview.item.output : undefined;
    expect(output).toMatchObject({ text: "aaaaaaaEND", truncated: true, totalBytes: 53 });
    expect(previewRecord(record, 100)).toBe(record);
  });
});
