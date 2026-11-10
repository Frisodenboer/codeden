import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type BrowserServerMessage,
  BrowserTabResponse,
  BrowserTabsResponse,
  DevServersResponse,
  SessionSnapshot,
} from "@codeden/contracts";
import { findInstalledChannels } from "@codeden/runner";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type Harness, startHarness, TOKEN, waitUntil } from "./support/harness";

const hasBrowser = findInstalledChannels().length > 0;

const PAGE = `<!doctype html><html><head><title>Panel test</title></head><body>
<button onclick="this.textContent='clicked'; console.log('button clicked')">Press me</button>
<input aria-label="Name"><p id="out"></p>
</body></html>`;

/** A `/ws/browser` viewer that records every message. */
class Viewer {
  readonly messages: BrowserServerMessage[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => this.messages.push(JSON.parse(d.toString()) as BrowserServerMessage));
  }
  static async connect(base: string, query: string): Promise<Viewer> {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/browser?${query}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new Viewer(ws);
  }
  waitFor(pred: (m: BrowserServerMessage) => boolean, timeoutMs = 20_000) {
    return waitUntil(() => this.messages.find(pred), timeoutMs);
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
}

describe.skipIf(!hasBrowser)("session browser (panel routes, /ws/browser, agent tools)", () => {
  let h: Harness;
  let site: Server;
  let siteUrl: string;
  let sitePort: number;
  let sessionId: string;
  let mcp: Client;

  beforeAll(async () => {
    site = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    sitePort = (site.address() as AddressInfo).port;
    siteUrl = `http://127.0.0.1:${sitePort}/`;
    h = await startHarness();
    sessionId = await h.startFakeSession();
    const token = h.server.services.mcpTokens.mint({
      role: "agent",
      sessionId,
      projectId: h.projectId,
    });
    mcp = new Client({ name: "test", version: "0.0.0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(h.server.runner?.mcpProxyUrl as string), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await mcp?.close();
    await h?.close();
    site?.closeAllConnections();
    await new Promise((r) => site?.close(r));
  }, 30_000);

  const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
    (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");

  it("a viewer waits for the browser, then streams frames once the agent opens it", async () => {
    const tabs = BrowserTabsResponse.parse(
      (await h.api("GET", `/sessions/${sessionId}/browser/tabs`)).body,
    );
    expect(tabs).toEqual({ open: false, tabs: [] });

    const viewer = await Viewer.connect(h.server.url, `sessionId=${sessionId}&maxFps=10`);
    await viewer.waitFor((m) => m.type === "state" && !m.open);
    // The panel reports its size before the browser exists; it applies once it opens.
    viewer.send({ type: "viewport", width: 460, height: 712, deviceScaleFactor: 3 });

    const nav = await mcp.callTool({ name: "browser_navigate", arguments: { url: siteUrl } });
    expect(nav.isError).toBeFalsy();
    expect(text(nav)).toContain("Panel test");
    // Agent tool calls light the panel's "Agent is acting" chip.
    await viewer.waitFor((m) => m.type === "agent" && m.acting);

    await viewer.waitFor((m) => m.type === "state" && m.open && m.watching);
    // The page follows this viewer's panel, scale clamped to 2x; frames are its device pixels.
    expect(await viewer.waitFor((m) => m.type === "viewport" && m.mine && m.width === 460)).toEqual(
      { type: "viewport", width: 460, height: 712, deviceScaleFactor: 2, mine: true },
    );
    const frame = await viewer.waitFor((m) => m.type === "frame" && m.width === 920);
    expect(frame).toMatchObject({ type: "frame", mediaType: "image/jpeg", height: 1424 });

    const snap = text(await mcp.callTool({ name: "browser_snapshot", arguments: {} }));
    const ref = /button "Press me" \[ref=(e\d+)\]/.exec(snap)?.[1];
    expect(ref).toBeTruthy();
    await mcp.callTool({ name: "browser_click", arguments: { ref } });
    expect(text(await mcp.callTool({ name: "browser_snapshot", arguments: {} }))).toContain(
      'button "clicked"',
    );
    const logs = text(await mcp.callTool({ name: "browser_logs", arguments: { kind: "console" } }));
    expect(logs).toContain("button clicked");
    const evaluated = await mcp.callTool({
      name: "browser_evaluate",
      arguments: { expression: "document.title" },
    });
    expect(text(evaluated)).toBe('"Panel test"');

    viewer.send({ type: "unwatch" });
    await viewer.waitFor((m) => m.type === "state" && m.open && !m.watching);
    viewer.ws.close();
  }, 60_000);

  it("takes a screenshot, stores it as an artifact, returns the image and shares it", async () => {
    const shot = await mcp.callTool({
      name: "browser_screenshot",
      arguments: { share: true, caption: "The test page" },
    });
    expect(shot.isError).toBeFalsy();
    const content = shot.content as Array<{ type: string; mimeType?: string; data?: string }>;
    expect(content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(content[1]?.mimeType).toBe("image/png");
    const artifacts = h.server.services.artifacts.list({ sessionId });
    expect(artifacts[0]).toMatchObject({ kind: "screenshot", mediaType: "image/png" });
    const snapshot = SessionSnapshot.parse(
      (await h.api("GET", `/sessions/${sessionId}/snapshot`)).body,
    );
    const notice = snapshot.items.find(
      (r) => r.item.kind === "notice" && r.item.code === "shared_artifact",
    );
    expect(notice?.item).toMatchObject({ message: "The test page" });
  }, 30_000);

  it("panel routes: tabs, navigate, history, viewport, dev servers", async () => {
    const base = `/sessions/${sessionId}/browser`;
    const opened = BrowserTabResponse.parse(
      (await h.api("POST", `${base}/dev-server`, { port: sitePort, path: "/" })).body,
    );
    expect(opened.tab.url).toContain(`localhost:${sitePort}`);
    const listed = BrowserTabsResponse.parse((await h.api("GET", `${base}/tabs`)).body);
    expect(listed.tabs.length).toBe(2);
    expect((await h.api("POST", `${base}/tabs/${opened.tab.tabId}/activate`)).status).toBe(200);
    const nav = await h.api("POST", `${base}/navigate`, { url: `${siteUrl}?again=1` });
    expect(nav.status).toBe(200);
    expect((await h.api("POST", `${base}/history`, { action: "back" })).status).toBe(200);
    expect((await h.api("POST", `${base}/viewport`, { width: 1024, height: 700 })).status).toBe(
      200,
    );
    expect((await h.api("DELETE", `${base}/tabs/${opened.tab.tabId}`)).status).toBe(200);
    expect((await h.api("POST", `${base}/navigate`, { url: "chrome://settings" })).status).toBe(
      502,
    );

    const servers = DevServersResponse.parse(
      (await h.api("GET", `/browser/dev-servers?probe=${sitePort}`)).body,
    );
    expect(servers.servers.map((s) => s.port)).toContain(sitePort);
  }, 60_000);

  it("closes the session's browser when the session stops", async () => {
    await h.api("POST", `/sessions/${sessionId}/stop`);
    await waitUntil(async () => {
      const tabs = BrowserTabsResponse.parse(
        (await h.api("GET", `/sessions/${sessionId}/browser/tabs`)).body,
      );
      return tabs.open ? undefined : true;
    });
    const res = await h.api("POST", `/sessions/${sessionId}/browser/history`, { action: "reload" });
    expect(res).toMatchObject({ status: 409, body: { error: { code: "browser_not_open" } } });
  }, 30_000);
});
