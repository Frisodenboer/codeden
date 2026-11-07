import type { SessionSnapshot, TranscriptMessage } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptWatchMessage } from "@/lib/api/client";
import { rankMentions } from "@/lib/api/http-client";
import { RealtimeSocket } from "@/lib/api/realtime-socket";
import { openTerminalSocket } from "@/lib/api/terminal-channel";
import { buildFileTree } from "@/lib/file-tree";
import { applyTranscriptMessage } from "@/lib/transcript/apply-transcript";
import { transcriptFromSnapshot } from "@/lib/transcript/reducer";

/** Minimal WebSocket double: records sent frames, lets the test push server frames. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data.startsWith("{") ? JSON.parse(data) : data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const ts = "2026-11-07T10:00:00.000Z";

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RealtimeSocket", () => {
  it("subscribes without agent events, watches sessions, and resumes from the last seq", () => {
    const socket = new RealtimeSocket("ws://127.0.0.1:1/ws");
    const global: unknown[] = [];
    const watched: TranscriptWatchMessage[] = [];
    socket.subscribe(5, (m) => global.push(m));
    socket.watch("s1", 7, (m) => watched.push(m));
    const ws = FakeSocket.instances[0];
    if (!ws) throw new Error("no socket");
    ws.open();
    expect(ws.sent).toEqual([
      { type: "subscribe", fromSeq: 5, agentEvents: false },
      { type: "watch_session", sessionId: "s1", fromSeq: 7 },
    ]);

    ws.push({
      type: "events",
      events: [{ seq: 9, sessionId: null, type: "x.unknown", payload: {}, ts }],
    });
    ws.push({ type: "transcript", sessionId: "s1", seq: 12, threads: [], turns: [], items: [] });
    expect(global).toHaveLength(1);
    expect(watched).toHaveLength(1);

    ws.drop();
    vi.advanceTimersByTime(600);
    const again = FakeSocket.instances[1];
    if (!again) throw new Error("no reconnect");
    again.open();
    expect(again.sent).toEqual([
      { type: "subscribe", fromSeq: 9, agentEvents: false },
      { type: "watch_session", sessionId: "s1", fromSeq: 12 },
    ]);
  });

  it("unwatches when the last listener leaves", () => {
    const socket = new RealtimeSocket("ws://x/ws");
    socket.subscribe(0, () => {});
    const a = socket.watch("s1", 0, () => {});
    const b = socket.watch("s1", 0, () => {});
    const ws = FakeSocket.instances[0];
    if (!ws) throw new Error("no socket");
    ws.open();
    ws.sent = [];
    a();
    expect(ws.sent).toEqual([]);
    b();
    expect(ws.sent).toEqual([{ type: "unwatch_session", sessionId: "s1" }]);
  });
});

describe("terminal channel", () => {
  it("buffers input until opened and splits control frames from output", () => {
    const ch = openTerminalSocket("ws://x", { sessionId: "s1", command: "echo hi" });
    const ws = FakeSocket.instances[0];
    if (!ws) throw new Error("no socket");
    expect(ws.url).toBe("ws://x/ws/pty?sessionId=s1&command=echo+hi");
    const out: string[] = [];
    const events: unknown[] = [];
    ch.onData((d) => out.push(d));
    ch.onEvent((e) => events.push(e));
    ch.write("ls\r");
    ws.readyState = 1;
    expect(ws.sent).toEqual([]);
    ws.push(`\u0000${JSON.stringify({ type: "opened", ptyId: "pty-1", pid: 3, attached: false })}`);
    expect(ws.sent).toEqual([{ type: "input", data: "ls\r" }]);
    ws.push("hello\r\n");
    expect(out).toEqual(["hello\r\n"]);
    expect(events).toEqual([{ type: "opened", ptyId: "pty-1", attached: false }]);
  });
});

describe("transcript watch", () => {
  const snap: SessionSnapshot = {
    seq: 3,
    session: {
      id: "s1",
      projectId: "p",
      role: "agent",
      parentSessionId: null,
      startedBy: { kind: "user" },
      purpose: "x",
      workKey: "request:x",
      scope: { projectId: "p" },
      progress: null,
      title: null,
      provider: "fake",
      model: null,
      effort: null,
      autonomy: "auto",
      status: "running",
      cwd: "/tmp",
      worktreePath: null,
      branch: null,
      baseBranch: null,
      issue: null,
      pr: null,
      resumeToken: null,
      runnerId: null,
      automationRunId: null,
      rootThreadId: "t1",
      createdAt: ts,
      updatedAt: ts,
      endedAt: null,
    } as SessionSnapshot["session"],
    threads: [
      {
        id: "t1",
        sessionId: "s1",
        parentThreadId: null,
        parentItemId: null,
        title: null,
        agentType: null,
        createdAt: ts,
      },
    ],
    turns: [
      {
        id: "u1",
        threadId: "t1",
        sessionId: "s1",
        status: "running",
        startedAt: ts,
        completedAt: null,
        error: null,
      },
    ],
    items: [
      {
        sessionId: "s1",
        threadId: "t1",
        turnId: "u1",
        position: 2,
        item: { id: "a", kind: "assistant_message", status: "in_progress", text: "Hel" },
        createdAt: ts,
        updatedAt: ts,
      },
    ],
  };

  it("replaces rows by id and orders new items by position", () => {
    const state = transcriptFromSnapshot(snap);
    const msg: TranscriptMessage = {
      type: "transcript",
      sessionId: "s1",
      seq: 8,
      threads: [],
      turns: [
        {
          ...snap.turns[0],
          status: "completed",
          completedAt: ts,
        } as TranscriptMessage["turns"][number],
      ],
      items: [
        {
          ...(snap.items[0] as TranscriptMessage["items"][number]),
          item: { id: "a", kind: "assistant_message", status: "completed", text: "Hello" },
        },
        {
          sessionId: "s1",
          threadId: "t1",
          turnId: "u1",
          position: 1,
          item: {
            id: "u",
            kind: "user_message",
            status: "completed",
            input: { text: "hi", attachments: [] },
          },
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    };
    const next = applyTranscriptMessage(state, msg);
    expect(next.seq).toBe(8);
    expect(next.threads.t1?.itemIds).toEqual(["u", "a"]);
    expect(next.items.a?.item).toMatchObject({ text: "Hello" });
    expect(next.turns.u1?.status).toBe("completed");
    expect(state.threads.t1?.itemIds).toEqual(["a"]);
  });
});

describe("files", () => {
  const list = {
    root: "/w",
    truncated: false,
    entries: [
      { path: "src", kind: "dir" as const },
      { path: "src/a.ts", kind: "file" as const },
      { path: "README.md", kind: "file" as const },
    ],
  };

  it("builds a tree with git badges", () => {
    const tree = buildFileTree(list.entries, [
      { path: "src/a.ts", status: "M" },
      { path: "README.md", status: "??" },
    ]);
    expect(tree.map((n) => n.path)).toEqual(["src", "README.md"]);
    expect(tree[0]?.children?.[0]).toMatchObject({ path: "src/a.ts", status: "modified" });
    expect(tree[1]?.status).toBe("added");
  });

  it("ranks @ mentions shortest first", () => {
    expect(rankMentions(list, "a").map((m) => m.path)).toEqual(["src/a.ts", "README.md"]);
  });
});
