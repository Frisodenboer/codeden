/**
 * Live workbench tests (real agent turns and a real image, small cost). Run with
 *   pnpm --filter @codeden/server test:live -- workbench
 * - browser: a real Claude session opens a local page through CodeDen's browser tools and
 *   shares a screenshot to the chat.
 * - generate_image: the Codex engine (the user's Codex login) writes an image into a
 *   session's worktree through the tool registry.
 */
import { existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { SessionSnapshot, StartSessionResponse } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness, waitUntil } from "../support/harness";

const LIVE = process.env.CODEDEN_LIVE === "1";
const CLAUDE_MODEL = process.env.CODEDEN_LIVE_CLAUDE_MODEL ?? "haiku";

const PAGE = `<!doctype html><html><head><title>CodeDen live page</title></head>
<body style="font: 32px system-ui; background: #fdf6e3"><h1>Hello from the live test</h1></body></html>`;

describe.skipIf(!LIVE)("live workbench", () => {
  let h: Harness;
  let site: Server;
  let siteUrl: string;

  beforeAll(async () => {
    site = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
    h = await startHarness({ builtinProviders: true, log: (m) => console.log(`[server] ${m}`) });
  }, 60_000);

  afterAll(async () => {
    await h?.close();
    site?.closeAllConnections();
    await new Promise((r) => site?.close(r));
  });

  it("claude: opens a local page with the browser tools and shares a screenshot", async () => {
    const prompt = [
      `Use the codeden browser_navigate tool to open ${siteUrl}`,
      "Then call the codeden browser_screenshot tool with share set to true and caption 'Live page'.",
      "Then reply with the page's main heading and nothing else.",
    ].join("\n");
    const res = await h.api("POST", "/sessions", {
      projectId: h.projectId,
      provider: "claude",
      model: CLAUDE_MODEL,
      effort: "low",
      autonomy: "auto",
      purpose: "Live browser",
      workspace: { mode: "worktree" },
      input: { text: prompt },
    });
    const started = StartSessionResponse.parse(res.body);
    if (started.status !== "started") throw new Error(`not started: ${started.status}`);
    const id = started.sessionId;
    const t0 = Date.now();
    await waitUntil(async () => {
      const d = await h.detail(id);
      if (d.session.status === "failed") throw new Error(`session failed: ${JSON.stringify(d)}`);
      return d.session.status === "idle" && d.session.rootThreadId ? d : undefined;
    }, 300_000);
    console.log(`[live] browser turn finished in ${Math.round((Date.now() - t0) / 1000)}s`);

    const snapshot = SessionSnapshot.parse((await h.api("GET", `/sessions/${id}/snapshot`)).body);
    for (const r of snapshot.items) {
      const it = r.item;
      if (it.kind === "tool_call") console.log(`[live]   tool ${it.toolName} ${it.status}`);
      if (it.kind === "assistant_message") console.log(`[live]   says: ${it.text.slice(0, 200)}`);
    }
    const tools = snapshot.items.flatMap((r) => (r.item.kind === "tool_call" ? [r.item] : []));
    expect(tools.some((t) => t.toolName.includes("browser_navigate"))).toBe(true);
    expect(tools.some((t) => t.toolName.includes("browser_screenshot"))).toBe(true);
    const shots = h.server.services.artifacts.list({ sessionId: id });
    expect(shots.some((a) => a.kind === "screenshot")).toBe(true);
    const notice = snapshot.items.find(
      (r) => r.item.kind === "notice" && r.item.code === "shared_artifact",
    );
    expect(notice).toBeTruthy();
    const reply = snapshot.items.filter((r) => r.item.kind === "assistant_message").at(-1);
    expect(reply?.item.kind === "assistant_message" && reply.item.text).toMatch(/Hello from/);
    await h.api("POST", `/sessions/${id}/stop`);
  }, 360_000);

  it("codex image engine: generate_image writes into the worktree", async () => {
    const images = h.server.services.images;
    await images.refresh();
    const engines = await images.engines();
    console.log(`[live] image engines: ${JSON.stringify(engines.engines)}`);
    expect(engines.active.engine).toBe("codex");
    const sessionId = await h.startFakeSession();
    const t0 = Date.now();
    const result = await h.server.services.tools.call(
      "generate_image",
      {
        prompt: "A minimal flat icon of a fox head, orange on white",
        aspectRatio: "1:1",
        quality: "low",
        outputPath: "assets/fox.png",
      },
      {
        role: "agent",
        sessionId,
        projectId: h.projectId,
        caller: "ui",
        signal: new AbortController().signal,
      },
    );
    console.log(`[live] generate_image (${Math.round((Date.now() - t0) / 1000)}s): ${result.text}`);
    expect(result.isError).toBe(false);
    const session = (await h.detail(sessionId)).session;
    const file = join(session.worktreePath ?? session.cwd, "assets", "fox.png");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1_000);
    expect(h.server.services.artifacts.list({ sessionId }).some((a) => a.kind === "image")).toBe(
      true,
    );
  }, 300_000);
});
