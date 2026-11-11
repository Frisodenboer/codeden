import { readFileSync } from "node:fs";
import { AgentEvent, type ItemOf } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { SseParser } from "../src/opencode/client";
import { parseSlashCommand, toOpencodeCommands } from "../src/opencode/commands";
import { parseOpencodeAuthList } from "../src/opencode/detect";
import { classifyOpencodeError } from "../src/opencode/errors";
import { OpencodeEventMapper } from "../src/opencode/mapper";
import { opencodeModels, splitOpencodeModel } from "../src/opencode/models";
import {
  decidePermission,
  opencodeMcpConfig,
  opencodeMcpName,
  opencodePermissions,
} from "../src/opencode/policy";
import { parseListeningUrl } from "../src/opencode/process";
import { approvalItem, questionItem, toOpencodeParts } from "../src/opencode/session";
import type { OcEvent, OcPermissionRequest } from "../src/opencode/types";

const SESSION = "ses_e3558f5a4ffepFXzkQ3QSA66z4";

/** A real `zai-coding-plan/glm-5.3-flash` run: write a file, run `ls`, answer "done". */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/opencode/basic-events.json", import.meta.url), "utf8"),
) as OcEvent[];

function setup(opts: ConstructorParameters<typeof OpencodeEventMapper>[2] = {}) {
  const events: AgentEvent[] = [];
  const mapper = new OpencodeEventMapper("s1", (e) => events.push(AgentEvent.parse(e)), opts);
  mapper.opencodeSessionId = SESSION;
  return { mapper, events };
}

const completed = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === "item.completed" ? [e.item] : []));

describe("OpencodeEventMapper on a recorded GLM run", () => {
  it("maps the turn to valid events: write, bash, text, usage, completion", () => {
    const { mapper, events } = setup({ contextWindow: () => 1_000_000 });
    mapper.beginTurn();
    for (const e of fixture) mapper.handle(e);

    expect(events[0]?.type).toBe("turn.started");
    expect(events.at(-1)?.type).toBe("turn.completed");
    expect(mapper.currentTurnId).toBeUndefined();

    const items = completed(events);
    const tools = items.filter((i): i is ItemOf<"tool_call"> => i.kind === "tool_call");
    const write = tools.find((t) => t.toolName === "write");
    expect(write).toMatchObject({
      toolKind: "file_edit",
      status: "completed",
      changes: [{ path: "C:\\work\\hello.txt", change: "add" }],
    });
    const bash = tools.find((t) => t.toolName === "bash");
    expect(bash).toMatchObject({
      toolKind: "command",
      command: "ls",
      exitCode: 0,
      status: "completed",
      output: { text: "hello.txt\n" },
    });

    const text = items.find((i) => i.kind === "assistant_message");
    expect(text).toMatchObject({ text: "done", status: "completed" });
    // The user's own prompt part is never echoed as assistant text.
    expect(items.some((i) => i.kind === "assistant_message" && i.text.includes("hello.txt"))).toBe(
      false,
    );

    const deltas = events.filter((e) => e.type === "item.delta");
    expect(deltas.some((d) => d.type === "item.delta" && d.delta.type === "text")).toBe(true);
    expect(
      deltas.some(
        (d) =>
          d.type === "item.delta" &&
          d.delta.type === "tool_output" &&
          d.delta.text === "hello.txt\n",
      ),
    ).toBe(true);

    const usage = events.filter((e) => e.type === "usage.updated").at(-1);
    expect(usage?.type === "usage.updated" && usage.usage).toMatchObject({
      contextWindow: 1_000_000,
      inputTokens: 11567 + 164 + 54,
    });
    expect(
      events.some(
        (e) => e.type === "session.updated" && e.model === "zai-coding-plan/glm-5.3-flash",
      ),
    ).toBe(true);
  });

  it("ignores events of other opencode sessions and events outside a turn", () => {
    const { mapper, events } = setup();
    for (const e of fixture) mapper.handle(e);
    expect(events.filter((e) => e.type !== "session.updated")).toEqual([]);

    const other = setup();
    other.mapper.opencodeSessionId = "ses_other";
    other.mapper.beginTurn();
    for (const e of fixture) other.mapper.handle(e);
    expect(other.events.map((e) => e.type)).toEqual(["turn.started"]);
  });

  it("links a permission request to the tool call it gates", () => {
    const { mapper } = setup();
    mapper.beginTurn();
    const asked = fixture.find((e) => e.type === "permission.asked");
    for (const e of fixture) {
      if (e === asked) break;
      mapper.handle(e);
    }
    if (asked?.type !== "permission.asked") throw new Error("fixture has no permission.asked");
    const item = approvalItem(asked.properties, mapper.itemForCall(asked.properties.tool?.callID));
    expect(item).toMatchObject({
      action: "file_change",
      requestId: asked.properties.id,
      toolCallItemId: "prt_1caa73344001w6PU9EiaZYvzh3",
    });
  });
});

describe("OpencodeEventMapper turn outcomes", () => {
  const idle: OcEvent = { type: "session.idle", properties: { sessionID: SESSION } };

  it("fails the turn with the error kind (auth, usage limit, context)", () => {
    const cases: [object, string][] = [
      [{ name: "ProviderAuthError", data: { providerID: "zai", message: "bad key" } }, "auth"],
      [
        {
          name: "APIError",
          data: { message: "Unauthorized", statusCode: 401, isRetryable: false },
        },
        "auth",
      ],
      [
        {
          name: "APIError",
          data: { message: "Usage limit reached (1308)", statusCode: 429, isRetryable: true },
        },
        "usage_limit",
      ],
      [
        {
          name: "APIError",
          data: { message: "Too many requests", statusCode: 429, isRetryable: true },
        },
        "transient",
      ],
      [{ name: "ContextOverflowError", data: { message: "too long" } }, "context_full"],
    ];
    for (const [error, kind] of cases) {
      const { mapper, events } = setup();
      mapper.beginTurn();
      mapper.handle({
        type: "session.error",
        properties: { sessionID: SESSION, error },
      } as OcEvent);
      mapper.handle(idle);
      const last = events.at(-1);
      expect(last?.type).toBe("turn.failed");
      expect(last?.type === "turn.failed" && last.error.kind).toBe(kind);
    }
  });

  it("reports an aborted turn as interrupted", () => {
    const { mapper, events } = setup();
    mapper.beginTurn();
    mapper.markAborted();
    mapper.handle({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        error: { name: "MessageAbortedError", data: { message: "Aborted" } },
      },
    });
    mapper.handle(idle);
    expect(events.at(-1)?.type).toBe("turn.interrupted");
  });

  it("keeps a todo list and closes it with the turn", () => {
    const { mapper, events } = setup();
    mapper.beginTurn();
    mapper.handle({
      type: "todo.updated",
      properties: {
        sessionID: SESSION,
        todos: [{ content: "a", status: "in_progress", priority: "high" }],
      },
    });
    mapper.handle({
      type: "todo.updated",
      properties: {
        sessionID: SESSION,
        todos: [{ content: "a", status: "completed", priority: "high" }],
      },
    });
    mapper.handle(idle);
    const todo = completed(events).find((i) => i.kind === "todo_list");
    expect(todo).toMatchObject({
      status: "completed",
      todos: [{ text: "a", status: "completed" }],
    });
  });

  it("recognises MCP tools by server prefix", () => {
    const { mapper } = setup({ mcpServers: ["codeden"] });
    const item = mapper.toolItem({
      id: "prt_1",
      sessionID: SESSION,
      messageID: "msg_1",
      type: "tool",
      callID: "c1",
      tool: "codeden_report_progress",
      state: {
        status: "completed",
        input: {},
        output: "ok",
        title: "",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    });
    expect(item).toMatchObject({ toolKind: "mcp", server: "codeden", tool: "report_progress" });
  });
});

describe("opencode helpers", () => {
  it("parses `opencode auth list` without reading keys", () => {
    const out =
      "\u001b[0m\r\n\u001b[90m┌\u001b[39m  Credentials \u001b[90m~\\.local\\share\\opencode\\auth.json\n" +
      "\u001b[90m│\u001b[39m\n\u001b[34m●\u001b[39m  OpenCode \u001b[90mapi\n\u001b[90m│\u001b[39m\n" +
      "\u001b[34m●\u001b[39m  Z.AI Coding Plan \u001b[90mapi\n\u001b[90m└\u001b[39m  2 credentials\n";
    expect(parseOpencodeAuthList(out)).toEqual(["OpenCode", "Z.AI Coding Plan"]);
    expect(parseOpencodeAuthList("┌  Credentials\n└  0 credentials\n")).toEqual([]);
  });

  it("reads the server address", () => {
    expect(
      parseListeningUrl("Warning: ...\nopencode server listening on http://127.0.0.1:51234\n"),
    ).toBe("http://127.0.0.1:51234");
    expect(parseListeningUrl("starting")).toBeUndefined();
  });

  it("splits model ids on the first slash only", () => {
    expect(splitOpencodeModel("zai-coding-plan/glm-5.3")).toEqual({
      providerID: "zai-coding-plan",
      modelID: "glm-5.3",
    });
    expect(splitOpencodeModel("openrouter/anthropic/x")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/x",
    });
    expect(splitOpencodeModel("default")).toBeUndefined();
  });

  it("lists models with context windows and efforts from variants", () => {
    const models = opencodeModels({
      default: { "zai-coding-plan": "glm-5.3" },
      providers: [
        {
          id: "zai-coding-plan",
          name: "Z.AI Coding Plan",
          models: {
            "glm-5.3": {
              id: "glm-5.3",
              providerID: "zai-coding-plan",
              name: "GLM-5.3",
              status: "active",
              limit: { context: 1_000_000, output: 131072 },
              variants: { low: {}, high: {}, max: {} },
            },
            old: { id: "old", providerID: "zai-coding-plan", name: "Old", status: "deprecated" },
          },
        },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["default", "zai-coding-plan/glm-5.3"]);
    expect(models[1]).toMatchObject({
      label: "GLM-5.3",
      contextWindow: 1_000_000,
      efforts: ["low", "high", "max"],
      defaultEffort: "high",
    });
  });

  it("parses server-sent events split across chunks", () => {
    const got: string[] = [];
    const parser = new SseParser((e) => got.push(e.type));
    parser.push('data: {"type":"server.connected","properties":{}}\n\ndata: {"type":"sess');
    parser.push('ion.idle","properties":{"sessionID":"s"}}\n\ndata: not json\n\n');
    parser.push('data: {"payload":{"type":"todo.updated","properties":{}}}\r\n\r\n');
    expect(got).toEqual(["server.connected", "session.idle", "todo.updated"]);
  });

  it("turns attachments into file parts", () => {
    const parts = toOpencodeParts({
      text: "look",
      attachments: [
        { type: "image", mediaType: "image/png", source: { type: "base64", data: "aGk=" } },
      ],
    });
    expect(parts).toEqual([
      { type: "text", text: "look" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,aGk=" },
    ]);
  });

  it("maps questions with ids in order", () => {
    const item = questionItem({
      id: "que_1",
      sessionID: SESSION,
      questions: [
        { question: "Which?", header: "Pick", options: [{ label: "A" }], multiple: true },
      ],
    });
    expect(item.questions[0]).toMatchObject({
      id: "q0",
      header: "Pick",
      multiSelect: true,
      allowFreeText: true,
    });
  });

  it("classifies unknown errors by their text", () => {
    expect(
      classifyOpencodeError({ name: "UnknownError", data: { message: "401 token expired" } }).kind,
    ).toBe("auth");
    expect(classifyOpencodeError(undefined).kind).toBe("fatal");
  });
});

describe("opencode permission policy", () => {
  const cwd = "/repo/wt";
  const inside = "/repo/wt/src/a.ts";
  const outside = "/etc/hosts";
  const req = (permission: string, metadata: Record<string, unknown>, patterns: string[] = []) =>
    ({
      id: "per_1",
      sessionID: "s",
      permission,
      patterns,
      metadata,
      always: [],
    }) as OcPermissionRequest;
  const decide = (
    r: OcPermissionRequest,
    autonomy: "read_only" | "supervised" | "auto" | "full",
    readOnly = false,
  ) =>
    decidePermission(r, { autonomy, readOnly, risk: { cwd, tempRoots: [], platform: "linux" } })
      .kind;

  it("asks for everything under Supervised", () => {
    expect(decide(req("bash", { command: "ls" }), "supervised")).toBe("ask");
    expect(decide(req("edit", { filepath: inside }), "supervised")).toBe("ask");
  });

  it("lets the classifier decide under Auto", () => {
    expect(decide(req("bash", { command: "pnpm test" }), "auto")).toBe("allow");
    expect(decide(req("edit", { filepath: inside }), "auto")).toBe("allow");
    expect(decide(req("edit", { filepath: outside }), "auto")).toBe("ask");
    expect(decide(req("bash", { command: "git push --force origin main" }), "auto")).toBe("ask");
    expect(decide(req("doom_loop", {}), "auto")).toBe("ask");
  });

  it("allows all but writes outside the worktree under Full", () => {
    expect(decide(req("bash", { command: "git push --force origin main" }), "full")).toBe("allow");
    expect(decide(req("edit", { filepath: outside }), "full")).toBe("ask");
  });

  it("refuses edits and writing commands when read-only", () => {
    expect(decide(req("edit", { filepath: inside }), "read_only")).toBe("deny");
    expect(decide(req("bash", { command: "rm -rf src" }), "read_only")).toBe("deny");
    expect(decide(req("bash", { command: "git status" }), "read_only")).toBe("allow");
    // Agents at read_only may run checks; read-only roles (PMs) may not.
    expect(decide(req("bash", { command: "pnpm test" }), "read_only")).toBe("allow");
    expect(decide(req("bash", { command: "pnpm test" }), "auto", true)).toBe("deny");
    expect(decide(req("webfetch", { url: "https://example.com" }), "auto", true)).toBe("allow");
  });

  it("asks for every edit natively, denies edits for read-only roles, trusts CodeBench tools", () => {
    const rules = opencodePermissions({ readOnly: false }, [
      { name: "codeden-abc", trusted: true },
      { name: "other-abc", trusted: false },
    ]);
    const action = (p: string) => rules.find((r) => r.permission === p)?.action;
    expect(action("edit")).toBe("ask");
    expect(action("bash")).toBe("ask");
    expect(action("codeden-abc_*")).toBe("allow");
    expect(action("other-abc_*")).toBe("ask");
    expect(
      opencodePermissions({ readOnly: true }).find((r) => r.permission === "edit")?.action,
    ).toBe("deny");
  });

  it("registers MCP servers under a per-session name with the bearer header", () => {
    expect(opencodeMcpName("codeden", "0193c3f2-aaaa-bbbb-cccc-1234567890ab")).toBe(
      "codeden-567890ab",
    );
    expect(
      opencodeMcpConfig({
        transport: "http",
        name: "codeden",
        url: "http://127.0.0.1:1/mcp",
        headers: { Authorization: "Bearer t" },
        toolTimeoutSec: 600,
        trusted: true,
      }),
    ).toEqual({
      type: "remote",
      url: "http://127.0.0.1:1/mcp",
      headers: { Authorization: "Bearer t" },
      oauth: false,
      timeout: 600_000,
    });
  });
});

describe("opencode slash commands", () => {
  it("parses `/name args` and leaves plain text alone", () => {
    expect(parseSlashCommand("/review src/a.ts carefully")).toEqual({
      name: "review",
      args: "src/a.ts carefully",
    });
    expect(parseSlashCommand("/init")).toEqual({ name: "init", args: "" });
    expect(parseSlashCommand("fix /tmp paths")).toBeUndefined();
  });

  it("turns opencode's command list into menu rows", () => {
    expect(
      toOpencodeCommands([
        { name: "init", description: "create AGENTS.md", template: "", hints: [] },
        { name: "seo", source: "skill", template: "", hints: ["$ARGUMENTS"] },
      ]),
    ).toEqual([
      { name: "init", description: "create AGENTS.md", kind: "command" },
      { name: "seo", description: "$ARGUMENTS", kind: "skill" },
    ]);
  });
});
