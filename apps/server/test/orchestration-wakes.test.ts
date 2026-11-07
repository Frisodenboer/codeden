import type { RawEventEnvelope, Session } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveNotices } from "../src/services/orchestration/notices";
import { type WakeResult, WakeScheduler } from "../src/services/orchestration/wake-scheduler";
import { sampleSession } from "./helpers";

describe("wake scheduler (§8.2 batching, debounce, loop guard)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  const scheduler = (results: WakeResult[] = [], opts = {}) => {
    const fired: string[] = [];
    const s = new WakeScheduler(
      async (key) => {
        fired.push(key);
        return results.shift() ?? "sent";
      },
      { debounceMs: 5_000, maxWaitMs: 30_000, maxWakes: 2, windowMs: 60_000, ...opts },
    );
    return { s, fired };
  };

  it("batches notices that arrive close together into one wake", async () => {
    const { s, fired } = scheduler();
    s.request("pm:p1");
    await vi.advanceTimersByTimeAsync(3_000);
    s.request("pm:p1");
    await vi.advanceTimersByTimeAsync(3_000);
    s.request("pm:p1");
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toEqual(["pm:p1"]);
    expect(s.isPending("pm:p1")).toBe(false);
  });

  it("never holds a notice longer than maxWait while more keep arriving", async () => {
    const { s, fired } = scheduler();
    for (let t = 0; t < 40_000; t += 4_000) {
      s.request("pm:p1");
      await vi.advanceTimersByTimeAsync(4_000);
    }
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0]).toBe("pm:p1");
  });

  it("keys targets separately", async () => {
    const { s, fired } = scheduler();
    s.request("pm:p1");
    s.request("orchestrator");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired.sort()).toEqual(["orchestrator", "pm:p1"]);
  });

  it("retries a busy target after the debounce", async () => {
    const { s, fired } = scheduler(["busy", "sent"]);
    s.request("pm:p1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toEqual(["pm:p1"]);
    expect(s.isPending("pm:p1")).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toEqual(["pm:p1", "pm:p1"]);
    expect(s.isPending("pm:p1")).toBe(false);
  });

  it("holds wakes beyond the loop guard until the window frees up", async () => {
    const suppressed: string[] = [];
    const { s, fired } = scheduler([], { onSuppressed: (key: string) => suppressed.push(key) });
    for (let i = 0; i < 2; i += 1) {
      s.request("pm:p1");
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(fired).toHaveLength(2);
    expect(s.allowed("pm:p1")).toBe(false);
    s.request("pm:p1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toHaveLength(2);
    expect(suppressed).toEqual(["pm:p1"]);
    // The first wake (t=5s) leaves the 60 s window at t=65s.
    await vi.advanceTimersByTimeAsync(55_000);
    expect(fired).toHaveLength(3);
  });

  it("counts direct messages against the guard", () => {
    const { s } = scheduler();
    s.recordWake("orchestrator");
    s.recordWake("orchestrator");
    expect(s.allowed("orchestrator")).toBe(false);
    expect(s.allowed("pm:p1")).toBe(true);
  });

  it("drops a wake with nothing left to deliver", async () => {
    const { s, fired } = scheduler(["empty"]);
    s.request("pm:p1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toEqual(["pm:p1"]);
    expect(s.isPending("pm:p1")).toBe(false);
    expect(s.allowed("pm:p1")).toBe(true);
  });
});

describe("typed notices from events (§8.2 step 4)", () => {
  const ts = "2026-11-07T10:00:00.000Z";
  const agent: Session = {
    ...sampleSession,
    id: "a1",
    projectId: "p1",
    rootThreadId: "t1",
    startedBy: { kind: "pm", id: "pm1" },
    workKey: "issue:7",
    purpose: "Fix issue 7",
  };
  const userAgent: Session = { ...agent, id: "a2", startedBy: { kind: "user" } };
  const pm: Session = { ...agent, id: "pm1", role: "pm" };
  const sessions = new Map([agent, userAgent, pm].map((s) => [s.id, s]));
  const lookup = {
    session: (id: string) => sessions.get(id),
    finalMessage: () => "All done: tests pass",
  };
  let seq = 0;
  const ev = (type: string, sessionId: string | null, payload: unknown): RawEventEnvelope => ({
    seq: ++seq,
    sessionId,
    type,
    payload,
    ts,
  });

  it("maps root turn completions, questions, failures and PRs of agent sessions", () => {
    const out = deriveNotices(
      [
        ev("agent.turn.completed", "a1", { type: "turn.completed", threadId: "t1", turnId: "u1" }),
        ev("agent.turn.completed", "a1", {
          type: "turn.completed",
          threadId: "child",
          turnId: "u2",
        }),
        ev("inbox.created", null, {
          item: { id: "q1", kind: "question", title: "Which DB?", sessionId: "a1" },
        }),
        ev("inbox.created", null, {
          item: {
            id: "f1",
            kind: "run_failed",
            title: "Run failed",
            body: "boom",
            sessionId: "a1",
          },
        }),
        ev("session.updated", "a1", {
          session: { ...agent, pr: { number: 5, url: "https://x/pr/5", state: "open" } },
        }),
        ev("agent.turn.completed", "pm1", { type: "turn.completed", threadId: "t1", turnId: "u3" }),
      ],
      lookup,
    );
    expect(out.map((d) => d.notice.type)).toEqual([
      "session.finished",
      "session.needs_input",
      "session.failed",
      "pr.opened",
    ]);
    expect(out.every((d) => d.wake)).toBe(true);
    const finished = out[0]?.notice;
    expect(finished?.type === "session.finished" && finished.data.summary).toBe(
      "All done: tests pass",
    );
    expect(out.map((d) => d.notice.id)).toEqual([
      "session.finished:a1:u1",
      "session.needs_input:q1",
      "session.failed:f1",
      "pr.opened:a1:5",
    ]);
  });

  it("records user-started work without waking the PM, and skipped automation runs with a wake", () => {
    const out = deriveNotices(
      [
        ev("agent.turn.completed", "a2", { type: "turn.completed", threadId: "t1", turnId: "u9" }),
        ev("automation_run.updated", null, {
          run: {
            id: "r1",
            automationId: "auto1",
            projectId: "p1",
            status: "skipped",
            skipReason: "overlap",
            workKey: "automation:security-audit",
            purpose: "Security audit",
            sessionId: null,
          },
        }),
      ],
      lookup,
    );
    expect(out.map((d) => [d.notice.type, d.wake])).toEqual([
      ["session.finished", false],
      ["automation.skipped", true],
    ]);
  });
});
