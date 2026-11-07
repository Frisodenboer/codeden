import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClaudeAdapter } from "../../src/claude/adapter";
import { validateEventStream } from "../../src/replay/validate";
import { Collector, LIVE, LIVE_TIMEOUT, requestRecorder, sessionOptions, tempDir } from "./helpers";
import { checkInterrupt, checkSteer } from "./shared";

const MODEL = process.env.CODEDEN_LIVE_CLAUDE_MODEL ?? "haiku";

describe.skipIf(!LIVE)("Claude live smoke", () => {
  const adapter = new ClaudeAdapter();
  const cwd = tempDir();
  let resumeToken: string | undefined;
  let first: { close: () => Promise<void> } | undefined;
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const c of cleanups) await c();
  });

  it("detects the installed, logged-in CLI", async () => {
    const status = await adapter.detect();
    expect(status).toMatchObject({ installed: true, loggedIn: true, supported: true });
    expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("runs a real turn that edits a file", { timeout: LIVE_TIMEOUT }, async () => {
    const session = await adapter.openSession(sessionOptions(cwd, { model: MODEL }));
    cleanups.push(() => session.close());
    const c = new Collector(session);
    const r = await c.turn("Create hello.txt containing hi, then tell me you're done.");
    expect(r.end.type).toBe("turn.completed");
    expect(readFileSync(path.join(cwd, "hello.txt"), "utf8").trim()).toBe("hi");
    expect(
      r.events.some(
        (e) =>
          e.type === "item.completed" &&
          e.item.kind === "tool_call" &&
          e.item.toolKind === "file_edit",
      ),
    ).toBe(true);
    expect(r.events.some((e) => e.type === "usage.updated" && e.usage.costUsd !== undefined)).toBe(
      true,
    );
    resumeToken = session.resumeToken();
    first = session;
    expect(resumeToken).toBeTruthy();
    expect(validateEventStream(c.all)).toEqual([]);
  });

  it("round-trips an approval in supervised mode", { timeout: LIVE_TIMEOUT }, async () => {
    const session = await adapter.openSession(
      sessionOptions(tempDir(), { model: MODEL, autonomy: "supervised" }),
    );
    cleanups.push(() => session.close());
    const c = new Collector(session);
    const r = await c.turn("Run the shell command `echo approved` and tell me what it printed.");
    expect(r.end.type).toBe("turn.completed");
    expect(r.approvals.length).toBeGreaterThan(0);
    expect(r.approvals[0]).toMatchObject({
      action: "command",
      toolName: expect.stringMatching(/Bash|PowerShell/),
    });
    const done = r.events.find(
      (e) => e.type === "item.completed" && e.item.kind === "approval_request",
    );
    expect(done).toMatchObject({ item: { decision: "allow_once", status: "completed" } });
    const tool = r.events.find(
      (e) =>
        e.type === "item.completed" && e.item.kind === "tool_call" && e.item.toolKind === "command",
    );
    expect(
      tool?.type === "item.completed" && tool.item.kind === "tool_call" && tool.item.output?.text,
    ).toContain("approved");
  });

  it("asks for risky commands in auto mode and honours a denial", {
    timeout: LIVE_TIMEOUT,
  }, async () => {
    const session = await adapter.openSession(
      sessionOptions(tempDir(), { model: MODEL, autonomy: "auto" }),
    );
    cleanups.push(() => session.close());
    const c = new Collector(session);
    const r = await c.turn(
      "Run exactly this shell command once, without changing it: git push --force origin main. If it is denied, stop and say so.",
      () => ({ kind: "approval", decision: "deny", message: "Not allowed in this test" }),
    );
    expect(r.end.type).toBe("turn.completed");
    expect(r.approvals[0]).toMatchObject({ action: "git_destructive" });
    expect(
      r.events.find((e) => e.type === "item.completed" && e.item.kind === "approval_request"),
    ).toMatchObject({ item: { status: "declined" } });
  });

  it("resumes a previous session", { timeout: LIVE_TIMEOUT }, async () => {
    expect(resumeToken).toBeTruthy();
    await first?.close();
    const session = await adapter.openSession(sessionOptions(cwd, { model: MODEL, resumeToken }));
    cleanups.push(() => session.close());
    const r = await new Collector(session).turn(
      "What is the name of the file you created earlier in this conversation? Reply with just the file name.",
    );
    expect(r.end.type).toBe("turn.completed");
    expect(r.text).toContain("hello.txt");
  });

  it("runs a subagent as a child thread", { timeout: LIVE_TIMEOUT }, async () => {
    const session = await adapter.openSession(sessionOptions(tempDir(), { model: MODEL }));
    cleanups.push(() => session.close());
    const c = new Collector(session);
    const r = await c.turn(
      "Use the Agent tool to spawn exactly one general-purpose subagent that runs the shell command `echo from-subagent` and reports what it printed. Wait for it, then tell me the result in one sentence.",
    );
    expect(r.end.type).toBe("turn.completed");
    const child = r.events.find((e) => e.type === "thread.started" && e.thread.parentThreadId);
    expect(child).toBeDefined();
    const childId = child?.type === "thread.started" ? child.thread.id : "";
    expect(
      r.events.some(
        (e) => "threadId" in e && e.threadId === childId && e.type === "item.completed",
      ),
    ).toBe(true);
    expect(
      r.events.some(
        (e) =>
          e.type === "item.started" &&
          e.item.kind === "subagent" &&
          e.item.childThreadId === childId,
      ),
    ).toBe(true);
  });

  it("injects MCP servers with their headers", { timeout: LIVE_TIMEOUT }, async () => {
    const mcp = await requestRecorder();
    cleanups.push(mcp.close);
    const session = await adapter.openSession(
      sessionOptions(tempDir(), {
        model: MODEL,
        mcpServers: [
          {
            transport: "http",
            name: "codeden_test",
            url: mcp.url,
            headers: { Authorization: "Bearer live-test-token" },
          },
        ],
      }),
    );
    cleanups.push(() => session.close());
    await new Collector(session).turn("Reply with exactly: ok");
    expect(mcp.requests.some((r) => r.headers.authorization === "Bearer live-test-token")).toBe(
      true,
    );
  });

  it("routes AskUserQuestion to a user_question item", { timeout: LIVE_TIMEOUT }, async () => {
    const session = await adapter.openSession(sessionOptions(tempDir(), { model: MODEL }));
    cleanups.push(() => session.close());
    const r = await new Collector(session).turn(
      "Use the AskUserQuestion tool to ask me whether I prefer red or blue (options: Red, Blue). Then tell me which one I picked.",
      (item) =>
        item.kind === "user_question"
          ? { kind: "answer", answers: { [item.questions[0]?.id ?? "q1"]: ["Blue"] } }
          : { kind: "approval", decision: "allow_once" },
    );
    expect(r.end.type).toBe("turn.completed");
    const q = r.events.find((e) => e.type === "item.completed" && e.item.kind === "user_question");
    expect(q).toMatchObject({ item: { status: "completed", answers: { q1: ["Blue"] } } });
    expect(r.text.toLowerCase()).toContain("blue");
  });

  it("interrupts a running turn", { timeout: LIVE_TIMEOUT }, () =>
    checkInterrupt(adapter, { model: MODEL }),
  );

  it("steers a running turn", { timeout: LIVE_TIMEOUT }, () =>
    checkSteer(adapter, { model: MODEL }),
  );

  it("answers a utility one-shot", { timeout: LIVE_TIMEOUT }, async () => {
    const text = await adapter
      .utilityModel()
      .runOneShot({ prompt: "Reply with exactly the word pong and nothing else." });
    expect(text.toLowerCase()).toContain("pong");
  });

  it("left the worktree file in place", () => {
    expect(existsSync(path.join(cwd, "hello.txt"))).toBe(true);
  });
});
