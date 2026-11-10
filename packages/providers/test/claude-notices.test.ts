import { AgentEvent } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { ClaudeEventMapper } from "../src/claude/mapper";

function setup() {
  const events: AgentEvent[] = [];
  let n = 0;
  const mapper = new ClaudeEventMapper({
    sessionId: "s1",
    cwd: "/work/repo",
    emit: (e) => events.push(AgentEvent.parse(e)),
    newId: () => `id${++n}`,
  });
  mapper.start();
  const notices = () =>
    events.flatMap((e) =>
      e.type === "item.completed" && e.item.kind === "notice" ? [e.item] : [],
    );
  return { mapper, events, notices };
}

const retry = (attempt: number, extra: object = {}) => ({
  type: "system",
  subtype: "api_retry",
  attempt,
  max_retries: 10,
  retry_delay_ms: 12_400,
  error_status: 529,
  error: "overloaded",
  ...extra,
});

describe("Claude's own recovery shows in the transcript", () => {
  it("shows API retries as one notice per run of retries, updated in place", () => {
    const { mapper, notices } = setup();
    mapper.beginTurn();
    mapper.handle(retry(1));
    mapper.handle(retry(2, { retry_delay_ms: 30_000 }));
    const [first, second] = notices();
    expect(first).toMatchObject({
      level: "warning",
      code: "retrying",
      message:
        "The API request failed (overloaded, 529); Claude Code retries in 12s (attempt 1 of 10).",
      data: { attempt: 1, maxRetries: 10, retryDelayMs: 12_400, errorStatus: 529 },
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.message).toContain("in 30s (attempt 2 of 10)");

    // A later failure starts a new run, with its own notice.
    mapper.handle(retry(1, { error_status: null, error: "unknown" }));
    const third = notices()[2];
    expect(third?.id).not.toBe(first?.id);
    expect(third?.message).toBe(
      "The API request failed (unknown); Claude Code retries in 12s (attempt 1 of 10).",
    );
  });

  it("shows compaction while it runs, then its outcome in the same notice", () => {
    const { mapper, notices } = setup();
    mapper.beginTurn();
    mapper.handle({ type: "system", subtype: "status", status: "requesting" });
    expect(notices()).toHaveLength(0);
    mapper.handle({ type: "system", subtype: "status", status: "compacting" });
    mapper.handle({ type: "system", subtype: "status", status: "compacting" });
    expect(notices()).toEqual([expect.objectContaining({ code: "compacting", level: "info" })]);
    mapper.handle({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 190_000 },
    });
    const [compacting, compacted] = notices();
    expect(compacted).toMatchObject({ code: "context_compacted", message: "Context compacted" });
    expect(compacted?.id).toBe(compacting?.id);

    mapper.handle({ type: "system", subtype: "status", status: "compacting" });
    mapper.handle({
      type: "system",
      subtype: "status",
      status: null,
      compact_result: "failed",
      compact_error: "Conversation too long",
    });
    const failed = notices().at(-1);
    expect(failed).toMatchObject({
      level: "warning",
      code: "compact_failed",
      message: "Compacting the conversation failed: Conversation too long",
    });
    expect(failed?.id).toBe(notices().at(-2)?.id);
  });

  it("ignores status messages outside a compaction", () => {
    const { mapper, events } = setup();
    const before = events.length;
    mapper.handle({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    expect(events).toHaveLength(before);
  });
});
