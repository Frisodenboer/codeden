import { AgentEvent, type SessionOptions } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approvals";
import { handleServerRequest } from "../src/codex/approvals";
import { codexConfigOverrides, codexPolicy, toCodexInput } from "../src/codex/config";
import { parseCodexLoginStatus } from "../src/codex/detect";
import { mapThreadItem } from "../src/codex/items";
import { CodexEventMapper } from "../src/codex/mapper";
import type { ServerNotification, ServerRequest } from "../src/codex/protocol";

const T = "thread-x";
const TURN = "turn-1";

function setup() {
  const events: AgentEvent[] = [];
  const mapper = new CodexEventMapper("s1", (e) => events.push(AgentEvent.parse(e)));
  mapper.codexThreadId = T;
  const feed = (method: string, params: object) =>
    mapper.handle({ method, params: { threadId: T, ...params } } as unknown as ServerNotification);
  return { mapper, events, feed };
}

const turn = (status: string, error: object | null = null) => ({
  id: TURN,
  items: [],
  itemsView: "summary",
  status,
  error,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1000,
});

describe("CodexEventMapper", () => {
  it("maps a turn with streamed text, a patch and a command", () => {
    const { events, feed } = setup();
    feed("turn/started", { turn: turn("inProgress") });
    feed("item/completed", {
      turnId: TURN,
      item: {
        type: "userMessage",
        id: "u1",
        clientId: null,
        content: [{ type: "text", text: "hi", text_elements: [] }],
      },
    });
    feed("item/started", {
      turnId: TURN,
      item: {
        type: "agentMessage",
        id: "m1",
        text: "",
        phase: null,
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    });
    feed("item/agentMessage/delta", { turnId: TURN, itemId: "m1", delta: "Hel" });
    feed("item/agentMessage/delta", { turnId: TURN, itemId: "m1", delta: "lo" });
    feed("item/completed", {
      turnId: TURN,
      item: {
        type: "agentMessage",
        id: "m1",
        text: "Hello",
        phase: null,
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    });
    const patch = {
      type: "fileChange",
      id: "p1",
      changes: [{ path: "/w/hello.txt", kind: { type: "add" }, diff: "hi\n" }],
      status: "inProgress",
    };
    feed("item/started", { turnId: TURN, item: patch });
    feed("item/completed", { turnId: TURN, item: { ...patch, status: "completed" } });
    const cmd = {
      type: "commandExecution",
      id: "c1",
      pluginId: null,
      scriptPath: null,
      command: "pwsh -Command 'echo done'",
      cwd: "/w",
      processId: null,
      source: "agent",
      status: "inProgress",
      commandActions: [{ type: "unknown", command: "echo done" }],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    };
    feed("item/started", { turnId: TURN, item: cmd });
    feed("item/commandExecution/outputDelta", { turnId: TURN, itemId: "c1", delta: "done\n" });
    feed("item/completed", {
      turnId: TURN,
      item: {
        ...cmd,
        status: "completed",
        aggregatedOutput: "done\n",
        exitCode: 0,
        durationMs: 84,
      },
    });
    feed("thread/tokenUsage/updated", {
      turnId: TURN,
      tokenUsage: {
        total: {
          totalTokens: 100,
          inputTokens: 90,
          cachedInputTokens: 50,
          cacheWriteInputTokens: 0,
          outputTokens: 10,
          reasoningOutputTokens: 2,
        },
        last: {
          totalTokens: 60,
          inputTokens: 55,
          cachedInputTokens: 50,
          cacheWriteInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 1,
        },
        modelContextWindow: 258400,
      },
    });
    feed("turn/completed", { turn: turn("completed") });

    expect(events[0]).toMatchObject({
      type: "turn.started",
      threadId: "s1:thread-root",
      turnId: TURN,
    });
    const completed = events.flatMap((e) => (e.type === "item.completed" ? [e.item] : []));
    expect(completed.map((i) => i.kind)).toEqual([
      "user_message",
      "assistant_message",
      "tool_call",
      "tool_call",
    ]);
    expect(completed[2]).toMatchObject({
      toolKind: "file_edit",
      changes: [{ path: "/w/hello.txt", change: "add", additions: 1 }],
    });
    expect(completed[3]).toMatchObject({
      toolKind: "command",
      command: "echo done",
      exitCode: 0,
      output: { text: "done\n" },
      durationMs: 84,
    });
    expect(events.find((e) => e.type === "usage.updated")).toMatchObject({
      usage: {
        inputTokens: 90,
        outputTokens: 10,
        cachedInputTokens: 50,
        reasoningTokens: 2,
        contextTokens: 60,
        contextWindow: 258400,
      },
    });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed" });
  });

  it("maps plans to a todo list and finishes dangling items on interrupt", () => {
    const { events, feed } = setup();
    feed("turn/started", { turn: turn("inProgress") });
    feed("turn/plan/updated", {
      turnId: TURN,
      explanation: null,
      plan: [{ step: "A", status: "inProgress" }],
    });
    feed("turn/plan/updated", {
      turnId: TURN,
      explanation: null,
      plan: [
        { step: "A", status: "completed" },
        { step: "B", status: "pending" },
      ],
    });
    feed("item/started", {
      turnId: TURN,
      item: { type: "reasoning", id: "r1", summary: [], content: [] },
    });
    feed("turn/completed", { turn: turn("interrupted") });
    expect(
      events.filter((e) => "item" in e && e.item.kind === "todo_list").map((e) => e.type),
    ).toEqual(["item.started", "item.updated", "item.completed"]);
    expect(
      events.find((e) => e.type === "item.completed" && e.item.kind === "reasoning"),
    ).toMatchObject({ item: { status: "cancelled" } });
    expect(events.at(-1)).toMatchObject({ type: "turn.interrupted", reason: "user" });
  });

  it("fails turns with the Codex error and ignores other threads", () => {
    const { events, feed, mapper } = setup();
    mapper.handle({
      method: "turn/started",
      params: { threadId: "other", turn: turn("inProgress") },
    } as unknown as ServerNotification);
    expect(events).toHaveLength(0);
    feed("turn/started", { turn: turn("inProgress") });
    feed("turn/completed", {
      turn: turn("failed", {
        message: "Boom",
        codexErrorInfo: null,
        additionalDetails: "x",
        misalignment: null,
      }),
    });
    expect(events.at(-1)).toMatchObject({
      type: "turn.failed",
      error: { message: "Boom", detail: "x" },
    });
  });

  it("maps rate limits", () => {
    const { events, feed } = setup();
    feed("account/rateLimits/updated", {
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 85, windowDurationMins: 300, resetsAt: 1794465315 },
        secondary: null,
        rateLimitReachedType: null,
      },
    });
    expect(events[0]).toMatchObject({
      usage: { rateLimits: [{ id: "5h", status: "warning", usedPercent: 85 }] },
    });
  });
});

describe("Codex items", () => {
  it("classifies read and search command actions", () => {
    const base = {
      type: "commandExecution",
      id: "c",
      pluginId: null,
      scriptPath: null,
      command: "x",
      cwd: "/w",
      processId: null,
      source: "agent",
      status: "completed",
      aggregatedOutput: "",
      exitCode: 0,
      durationMs: 1,
    } as const;
    expect(
      mapThreadItem({
        ...base,
        commandActions: [{ type: "read", command: "cat a.ts", name: "a.ts", path: "/w/a.ts" }],
      } as never),
    ).toMatchObject({ toolKind: "file_read", path: "/w/a.ts" });
    expect(
      mapThreadItem({
        ...base,
        commandActions: [{ type: "search", command: "rg foo", query: "foo", path: null }],
      } as never),
    ).toMatchObject({ toolKind: "search", query: "foo" });
    expect(mapThreadItem({ ...base, exitCode: 1, commandActions: [] } as never)).toMatchObject({
      toolKind: "command",
      status: "failed",
    });
  });
});

describe("Codex approvals", () => {
  const ctx = { threadId: "s1:thread-root", turnId: TURN };
  const run = async (req: object, answer: object) => {
    const events: AgentEvent[] = [];
    const broker = new ApprovalBroker((e) => events.push(AgentEvent.parse(e)));
    const pending = handleServerRequest(req as ServerRequest, {
      broker,
      risk: { cwd: "/w", platform: "linux" },
      ctx: () => ctx,
      filePaths: () => ["/w/a.ts"],
    });
    const started = events[0];
    if (started?.type !== "item.started" || !("requestId" in started.item))
      throw new Error("no request");
    broker.respond(started.item.requestId, answer as never);
    return { result: await pending, events };
  };

  it("maps command approvals both ways and flags risky commands", async () => {
    const { result, events } = await run(
      {
        method: "item/commandExecution/requestApproval",
        id: 0,
        params: {
          threadId: T,
          turnId: TURN,
          itemId: "c1",
          command: "git push --force",
          cwd: "/w",
          startedAtMs: 1,
          environmentId: null,
        },
      },
      { kind: "approval", decision: "allow_session" },
    );
    expect(result).toEqual({ decision: "acceptForSession" });
    expect(events[0]).toMatchObject({
      item: { kind: "approval_request", action: "git_destructive", command: "git push --force" },
    });
    expect(events[1]).toMatchObject({
      item: { status: "completed", decision: "allow_session", decidedBy: "user" },
    });
  });

  it("maps file change approvals and denials", async () => {
    const { result, events } = await run(
      {
        method: "item/fileChange/requestApproval",
        id: 1,
        params: { threadId: T, turnId: TURN, itemId: "p1", startedAtMs: 1 },
      },
      { kind: "approval", decision: "deny" },
    );
    expect(result).toEqual({ decision: "decline" });
    expect(events[0]).toMatchObject({ item: { action: "file_change", paths: ["/w/a.ts"] } });
    expect(events[1]).toMatchObject({ item: { status: "declined" } });
  });

  it("maps user input questions", async () => {
    const { result } = await run(
      {
        method: "item/tool/requestUserInput",
        id: 2,
        params: {
          threadId: T,
          turnId: TURN,
          itemId: "q1",
          isBlocking: true,
          autoResolutionMs: null,
          questions: [
            {
              id: "lang",
              header: "Lang",
              question: "Which?",
              isOther: false,
              isSecret: false,
              options: [{ label: "TS", description: "" }],
            },
          ],
        },
      },
      { kind: "answer", answers: { lang: ["TS"] } },
    );
    expect(result).toEqual({ answers: { lang: { answers: ["TS"] } } });
  });
});

describe("Codex config", () => {
  const opts: SessionOptions = {
    sessionId: "s",
    role: "agent",
    cwd: "/w",
    autonomy: "auto",
    mcpServers: [
      {
        transport: "http",
        name: "codeden",
        url: "http://127.0.0.1:1/mcp",
        headers: { Authorization: "Bearer t" },
      },
    ],
    additionalDirectories: ["/extra"],
    planMode: false,
  };

  it("maps autonomy to sandbox and approval policy", () => {
    expect(codexPolicy("supervised")).toMatchObject({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
    expect(codexPolicy("auto")).toMatchObject({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      networkAccess: false,
    });
    expect(codexPolicy("full")).toMatchObject({ approvalPolicy: "never", networkAccess: true });
  });

  it("injects MCP servers and writable roots as config overrides", () => {
    expect(codexConfigOverrides(opts)).toEqual({
      "sandbox_workspace_write.network_access": false,
      "sandbox_workspace_write.writable_roots": ["/extra"],
      "mcp_servers.codeden": {
        url: "http://127.0.0.1:1/mcp",
        http_headers: { Authorization: "Bearer t" },
      },
    });
  });

  it("converts input with images", () => {
    expect(
      toCodexInput({
        text: "x",
        attachments: [
          { type: "image", mediaType: "image/png", source: { type: "base64", data: "AAAA" } },
        ],
      }),
    ).toEqual([
      { type: "text", text: "x", text_elements: [] },
      { type: "image", url: "data:image/png;base64,AAAA" },
    ]);
  });

  it("parses login status", () => {
    expect(parseCodexLoginStatus("Logged in using ChatGPT", 0)).toEqual({
      loggedIn: true,
      authMethod: "chatgpt",
    });
    expect(parseCodexLoginStatus("Logged in using an API key - sk-***", 0)).toEqual({
      loggedIn: true,
      authMethod: "api_key",
    });
    expect(parseCodexLoginStatus("Not logged in", 1)).toEqual({
      loggedIn: false,
      authMethod: null,
    });
    expect(parseCodexLoginStatus("", null)).toEqual({ loggedIn: null, authMethod: null });
  });
});
