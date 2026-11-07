import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newConfigLocation, newConfigTemplate } from "@/components/agents/config-templates";
import { formToSpec, parsePairs, specToForm } from "@/components/agents/mcp-form";
import { comboFromEvent } from "@/components/settings/voice-controls";
import { browserSocketQuery, openBrowserSocket } from "@/lib/api/browser-channel";
import { qs } from "@/lib/api/http-features";
import { naiveDiff } from "@/lib/api/mock/feature-apis";
import { keyInput, modifiersOf, mouseInput } from "@/lib/browser-input";
import { emptyTranscript } from "@/lib/transcript/reducer";
import { languageHint } from "@/lib/voice/cloud-stt";
import { latestCompletedRootTurn, turnJustFinished } from "@/lib/voice/read-aloud";

const noMods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("browser input mapping", () => {
  const box = {
    rect: { left: 100, top: 50, width: 400, height: 250 },
    frameWidth: 1280,
    frameHeight: 800,
  };

  it("maps a click from the displayed canvas into frame pixels", () => {
    const input = mouseInput(
      "mouse.down",
      { clientX: 300, clientY: 175, button: 0, detail: 2, ...noMods },
      box,
    );
    expect(input).toEqual({
      type: "mouse.down",
      x: 640,
      y: 400,
      frameWidth: 1280,
      frameHeight: 800,
      modifiers: 0,
      button: "left",
      clickCount: 2,
    });
  });

  it("clamps to the frame and carries wheel deltas and modifiers", () => {
    const input = mouseInput(
      "mouse.wheel",
      { clientX: 900, clientY: 0, deltaX: 0, deltaY: 120, ...noMods, shiftKey: true },
      box,
    );
    expect(input).toMatchObject({ x: 1280, y: 0, deltaY: 120, modifiers: 8 });
  });

  it("types printable keys and never types shortcuts' text on key up", () => {
    expect(keyInput("key.down", { key: "a", code: "KeyA", ...noMods })).toMatchObject({
      text: "a",
    });
    expect(keyInput("key.up", { key: "a", code: "KeyA", ...noMods })).not.toHaveProperty(
      "text",
      "a",
    );
    expect(keyInput("key.down", { key: "Enter", code: "Enter", ...noMods })?.type).toBe("key.down");
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("browser channel", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("builds the viewer query", () => {
    expect(browserSocketQuery("s1", { open: true, maxWidth: 1920.4, quality: 70 })).toBe(
      "sessionId=s1&open=1&quality=70&maxWidth=1920",
    );
  });

  it("queues control messages, drops early input, validates server messages and reconnects", () => {
    const ch = openBrowserSocket("ws://127.0.0.1:1", "s1");
    const got: unknown[] = [];
    ch.onMessage((m) => got.push(m.type));
    ch.open("http://localhost:5173");
    ch.input({ type: "text.insert", text: "lost" });
    const ws = FakeSocket.instances[0];
    if (!ws) throw new Error("no socket");
    expect(ws.url).toBe("ws://127.0.0.1:1/ws/browser?sessionId=s1");
    ws.readyState = 1;
    ws.onopen?.();
    expect(ws.sent).toEqual([{ type: "open", url: "http://localhost:5173" }]);
    ws.onmessage?.({ data: JSON.stringify({ type: "tabs", tabs: [] }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "frame", data: "x" }) }); // invalid: dropped
    expect(got).toEqual(["tabs"]);
    ws.readyState = 3;
    ws.onclose?.();
    vi.advanceTimersByTime(600);
    expect(FakeSocket.instances).toHaveLength(2);
    ch.close();
    expect(FakeSocket.instances[1]?.readyState).toBe(3);
  });
});

describe("agent configuration helpers", () => {
  it("round-trips MCP specs through the form and keeps unknown fields", () => {
    const spec = {
      type: "stdio" as const,
      command: "npx",
      args: ["@playwright/mcp@latest", "--headless"],
      env: { DEBUG: "1" },
      extra: { timeout: 30 },
    };
    expect(formToSpec(specToForm(spec), { supportsEnabled: false, previous: spec })).toEqual(spec);
    const http = {
      type: "http" as const,
      url: "https://x.test/mcp",
      headers: { Authorization: "Bearer a:b" },
    };
    const form = { ...specToForm(http), enabled: false };
    expect(formToSpec(form, { supportsEnabled: true })).toEqual({ ...http, enabled: false });
    expect(parsePairs("A=1\n\nbad\nB = two", "=")).toEqual({ A: "1", B: "two" });
  });

  it("puts new skills and subagents in each provider's folders", () => {
    expect(newConfigLocation("skill", "codex", "project", "notes", "p1")).toEqual({
      root: "project",
      projectId: "p1",
      path: ".agents/skills/notes/SKILL.md",
    });
    expect(newConfigLocation("subagent", "claude", "user", "rev", null)).toEqual({
      root: "home",
      path: ".claude/agents/rev.md",
    });
    expect(newConfigTemplate("subagent", "codex", "rev", 'Says "hi"')).toContain(
      'description = "Says \\"hi\\""',
    );
  });

  it("makes a unified diff for the mock server", () => {
    const d = naiveDiff("CLAUDE.md", "a\nb\nc\n", "a\nB\nc\n");
    expect(d).toMatchObject({ additions: 1, deletions: 1, changed: true });
    expect(d.patch).toContain("-b\n+B");
    expect(naiveDiff("x", "same", "same").changed).toBe(false);
  });

  it("drops empty query values", () => {
    expect(qs({ a: "1", b: undefined, c: null, d: true, e: false })).toBe("?a=1&d=1");
  });
});

describe("voice helpers", () => {
  it("detects a finished turn from session status changes", () => {
    expect(turnJustFinished("running", "idle")).toBe(true);
    expect(turnJustFinished("waiting", "completed")).toBe(true);
    expect(turnJustFinished("running", "failed")).toBe(false);
    expect(turnJustFinished(undefined, "idle")).toBe(false);
  });

  it("finds the newest completed root turn", () => {
    const s = emptyTranscript("s1");
    s.rootThreadId = "th";
    const turn = (
      id: string,
      startedAt: string,
      status: "completed" | "running",
      threadId = "th",
    ) => ({
      id,
      threadId,
      status,
      startedAt,
      completedAt: null,
      error: null,
    });
    s.turns = {
      a: turn("a", "2026-11-07T10:00:00Z", "completed"),
      b: turn("b", "2026-11-07T10:05:00Z", "completed"),
      c: turn("c", "2026-11-07T10:06:00Z", "running", "child"),
    };
    expect(latestCompletedRootTurn(s)).toBe("b");
    s.turns.d = turn("d", "2026-11-07T10:07:00Z", "running");
    expect(latestCompletedRootTurn(s)).toBeNull();
  });

  it("builds shortcut combos and language hints", () => {
    expect(
      comboFromEvent({ key: " ", ...noMods, ctrlKey: true, shiftKey: true } as KeyboardEvent),
    ).toBe("mod+shift+space");
    expect(comboFromEvent({ key: "Shift", ...noMods, shiftKey: true } as KeyboardEvent)).toBeNull();
    expect(languageHint("en-US")).toBe("en");
    expect(languageHint(null)).toBeUndefined();
  });
});
