import { AgentEvent, type SessionOptions } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approvals";
import { handleServerRequest } from "../src/codex/approvals";
import {
  codexConfigOverrides,
  codexPolicy,
  codexSandboxPolicy,
  codexWritableRoots,
  toCodexInput,
} from "../src/codex/config";
import { parseCodexLoginStatus } from "../src/codex/detect";
import type { ServerRequest } from "../src/codex/protocol";
import { osTempRoots } from "../src/policy/paths";

const T = "thread-x";
const TURN = "turn-1";

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
    expect(codexConfigOverrides(opts, ["/tmp"])).toEqual({
      "sandbox_workspace_write.network_access": false,
      "sandbox_workspace_write.writable_roots": ["/extra", "/tmp"],
      "mcp_servers.codeden": {
        url: "http://127.0.0.1:1/mcp",
        http_headers: { Authorization: "Bearer t" },
      },
    });
  });

  it("lets the sandbox write the OS temp directory in auto and full only", () => {
    const temp = ["/tmp", "/var/folders/x/T"];
    expect(codexWritableRoots({ ...opts, autonomy: "full" }, temp)).toEqual(["/extra", ...temp]);
    expect(codexWritableRoots({ ...opts, autonomy: "supervised" }, temp)).toEqual(["/extra"]);
    expect(codexWritableRoots({ ...opts, readOnly: true }, temp)).toEqual(["/extra"]);
    expect(
      codexConfigOverrides({ ...opts, autonomy: "supervised", additionalDirectories: [] }, temp),
    ).not.toHaveProperty("sandbox_workspace_write.writable_roots");
    // The defaults come from the running platform.
    expect(codexWritableRoots({ ...opts, additionalDirectories: [] })).toEqual([
      ...osTempRoots(),
    ]);
  });

  it("builds the per-turn sandbox override for each level", () => {
    expect(codexSandboxPolicy({ ...opts, autonomy: "full" }, ["/tmp"])).toEqual({
      type: "workspaceWrite",
      writableRoots: ["/extra", "/tmp"],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
    expect(codexSandboxPolicy({ ...opts, autonomy: "supervised" }, ["/tmp"])).toMatchObject({
      type: "workspaceWrite",
      writableRoots: ["/extra"],
      networkAccess: false,
    });
    expect(codexSandboxPolicy({ ...opts, readOnly: true }, ["/tmp"])).toEqual({
      type: "readOnly",
      networkAccess: false,
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
