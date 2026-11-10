import { AgentEvent } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { ClaudeEventMapper } from "../src/claude/mapper";
import { classifyCodexError, usageLimitResetsAt } from "../src/codex/errors";
import { CodexEventMapper } from "../src/codex/mapper";
import type { ServerNotification } from "../src/codex/protocol";

function claude() {
  const events: AgentEvent[] = [];
  let n = 0;
  const mapper = new ClaudeEventMapper({
    sessionId: "s1",
    cwd: "/work",
    emit: (e) => events.push(AgentEvent.parse(e)),
    newId: () => `id${++n}`,
  });
  mapper.start();
  mapper.beginTurn();
  const failure = () => {
    const last = events.at(-1);
    if (last?.type !== "turn.failed") throw new Error(`expected turn.failed, got ${last?.type}`);
    return last.error;
  };
  return { mapper, failure };
}

const errorResult = (extra: object) => ({
  type: "result",
  subtype: "success",
  is_error: true,
  result: "API Error",
  total_cost_usd: 0,
  ...extra,
});
const failedAssistant = (error: string, text = "") => ({
  type: "assistant",
  message: { id: "m1", content: text ? [{ type: "text", text }] : [] },
  parent_tool_use_id: null,
  error,
});

describe("Claude turn failures", () => {
  it("names an overloaded API as transient, from the assistant error or the HTTP status", () => {
    const a = claude();
    a.mapper.handle(failedAssistant("overloaded", "API Error: 529 Overloaded"));
    a.mapper.handle(errorResult({ api_error_status: 529, terminal_reason: "api_error" }));
    expect(a.failure()).toMatchObject({ code: "overloaded", kind: "transient", retryable: true });

    const b = claude();
    b.mapper.handle(errorResult({ api_error_status: 502 }));
    expect(b.failure()).toMatchObject({ kind: "transient" });
  });

  it("names a rejected usage window a usage limit, with when it resets", () => {
    const { mapper, failure } = claude();
    mapper.handle({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1794330000 },
    });
    mapper.handle(failedAssistant("rate_limit", "You've hit your limit"));
    mapper.handle(errorResult({ api_error_status: 429 }));
    expect(failure()).toMatchObject({
      kind: "usage_limit",
      retryAt: "2026-11-10T17:00:00.000Z",
      retryable: true,
    });
  });

  it("treats throttling without a rejected window as transient", () => {
    const { mapper, failure } = claude();
    mapper.handle(failedAssistant("rate_limit"));
    mapper.handle(errorResult({ api_error_status: 429 }));
    expect(failure()).toMatchObject({ kind: "transient" });
    expect(failure().retryAt).toBeUndefined();
  });

  it("names a full context, a login problem and a hard stop", () => {
    const full = claude();
    full.mapper.handle(
      errorResult({ terminal_reason: "prompt_too_long", result: "Prompt is too long" }),
    );
    expect(full.failure()).toMatchObject({ kind: "context_full", retryable: false });

    const auth = claude();
    auth.mapper.handle(failedAssistant("authentication_failed"));
    auth.mapper.handle(errorResult({ api_error_status: 401 }));
    expect(auth.failure()).toMatchObject({ kind: "auth", code: "authentication_failed" });

    const turns = claude();
    turns.mapper.handle(errorResult({ subtype: "error_max_turns", is_error: true }));
    expect(turns.failure()).toMatchObject({ kind: "fatal", code: "error_max_turns" });

    const internal = claude();
    internal.mapper.handle(errorResult({ subtype: "error_during_execution", errors: ["boom"] }));
    expect(internal.failure()).toMatchObject({ kind: "transient", message: "boom" });
  });

  it("forgets the previous turn's signals", () => {
    const { mapper, failure } = claude();
    mapper.handle(failedAssistant("rate_limit"));
    mapper.handle(errorResult({ api_error_status: 429 }));
    mapper.beginTurn();
    mapper.handle(errorResult({ subtype: "error_max_budget_usd" }));
    expect(failure()).toMatchObject({ kind: "fatal", code: "error_max_budget_usd" });
  });
});

describe("Codex turn failures", () => {
  const T = "thread-x";
  function codex() {
    const events: AgentEvent[] = [];
    const mapper = new CodexEventMapper("s1", (e) => events.push(AgentEvent.parse(e)));
    mapper.codexThreadId = T;
    const feed = (method: string, params: object) =>
      mapper.handle({
        method,
        params: { threadId: T, ...params },
      } as unknown as ServerNotification);
    const fail = (codexErrorInfo: unknown) => {
      feed("turn/started", {
        turn: { id: "turn-1", items: [], status: "inProgress", error: null },
      });
      feed("turn/completed", {
        turn: {
          id: "turn-1",
          items: [],
          status: "failed",
          error: { message: "Boom", codexErrorInfo, additionalDetails: null },
        },
      });
      const last = events.at(-1);
      if (last?.type !== "turn.failed") throw new Error("expected turn.failed");
      return last.error;
    };
    return { feed, fail };
  }

  it("classifies codexErrorInfo", () => {
    expect(codex().fail("serverOverloaded")).toMatchObject({
      code: "serverOverloaded",
      kind: "transient",
      retryable: true,
    });
    expect(codex().fail({ responseStreamDisconnected: { httpStatusCode: null } })).toMatchObject({
      code: "responseStreamDisconnected",
      kind: "transient",
    });
    expect(codex().fail("contextWindowExceeded")).toMatchObject({ kind: "context_full" });
    expect(codex().fail("unauthorized")).toMatchObject({ kind: "auth", retryable: false });
    expect(codex().fail("cyberPolicy")).toMatchObject({ kind: "fatal" });
    expect(classifyCodexError(null)).toBe("fatal");
  });

  it("gives a usage limit the reset time of the window that is used up", () => {
    const { feed, fail } = codex();
    feed("account/rateLimits/updated", {
      rateLimits: {
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1794330000 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1794900000 },
        rateLimitReachedType: "primary",
      },
    });
    expect(fail("usageLimitExceeded")).toMatchObject({
      kind: "usage_limit",
      retryAt: "2026-11-10T17:00:00.000Z",
    });
    expect(usageLimitResetsAt(undefined)).toBeUndefined();
  });
});
