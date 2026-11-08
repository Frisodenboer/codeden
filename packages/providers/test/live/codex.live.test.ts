import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/codex/adapter";
import { validateEventStream } from "../../src/replay/validate";
import { Collector, LIVE, LIVE_TIMEOUT, requestRecorder, sessionOptions, tempDir } from "./helpers";
import { checkInterrupt, checkSteer } from "./shared";

const MODEL = process.env.CODEDEN_LIVE_CODEX_MODEL;
const base = { effort: "low" as const, ...(MODEL ? { model: MODEL } : {}) };

describe.skipIf(!LIVE)("Codex live smoke", () => {
  const adapter = new CodexAdapter();
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
  });

  it("lists its models before any session (model/list only, no turn)", async () => {
    const fresh = new CodexAdapter();
    await fresh.refreshModels();
    const models = fresh.models();
    expect(models.length).toBeGreaterThan(1);
    expect(models.filter((m) => m.isDefault)).toHaveLength(1);
    expect(models.every((m) => m.id !== "default" && m.efforts.length > 0)).toBe(true);
  });

  it("runs a real turn that edits a file", { timeout: LIVE_TIMEOUT }, async () => {
    const session = await adapter.openSession(sessionOptions(cwd, base));
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
          // The model may write the file with the edit tool or a shell command.
          (e.item.toolKind === "file_edit" || e.item.toolKind === "command"),
      ),
    ).toBe(true);
    expect(r.events.some((e) => e.type === "usage.updated" && e.usage.inputTokens)).toBe(true);
    resumeToken = session.resumeToken();
    first = session;
    expect(resumeToken).toBeTruthy();
    expect(validateEventStream(c.all)).toEqual([]);
    expect(adapter.models().length).toBeGreaterThan(1);
  });

  it("round-trips an approval in supervised mode", { timeout: LIVE_TIMEOUT }, async () => {
    const session = await adapter.openSession(
      sessionOptions(tempDir(), { ...base, autonomy: "supervised" }),
    );
    cleanups.push(() => session.close());
    const r = await new Collector(session).turn(
      "Run the shell command `echo approved` and tell me what it printed.",
    );
    expect(r.end.type).toBe("turn.completed");
    expect(r.approvals.length).toBeGreaterThan(0);
    expect(r.approvals[0]).toMatchObject({ action: "command" });
    const tool = r.events.find(
      (e) =>
        e.type === "item.completed" && e.item.kind === "tool_call" && e.item.toolKind === "command",
    );
    expect(
      tool?.type === "item.completed" && tool.item.kind === "tool_call" && tool.item.output?.text,
    ).toContain("approved");
  });

  it("resumes a previous thread", { timeout: LIVE_TIMEOUT }, async () => {
    expect(resumeToken).toBeTruthy();
    // A Codex thread has one writer: the first app-server must be gone before resuming.
    await first?.close();
    const session = await adapter.openSession(sessionOptions(cwd, { ...base, resumeToken }));
    cleanups.push(() => session.close());
    expect(session.resumeToken()).toBe(resumeToken);
    const r = await new Collector(session).turn(
      "What is the name of the file you created earlier in this conversation? Reply with just the file name.",
    );
    expect(r.end.type).toBe("turn.completed");
    expect(r.text).toContain("hello.txt");
  });

  it("injects MCP servers with their headers", { timeout: LIVE_TIMEOUT }, async () => {
    const mcp = await requestRecorder();
    cleanups.push(mcp.close);
    const session = await adapter.openSession(
      sessionOptions(tempDir(), {
        ...base,
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

  it("interrupts a running turn", { timeout: LIVE_TIMEOUT }, () => checkInterrupt(adapter, base));

  it("steers a running turn", { timeout: LIVE_TIMEOUT }, () => checkSteer(adapter, base));

  it("answers a utility one-shot", { timeout: LIVE_TIMEOUT }, async () => {
    const text = await adapter
      .utilityModel()
      .runOneShot({ prompt: "Reply with exactly the word pong and nothing else." });
    expect(text.toLowerCase()).toContain("pong");
  });
});
