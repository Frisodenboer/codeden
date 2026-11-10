import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  BROWSER_RELAY_SECRET_HEADER,
  type BrowserHostServerMessage,
  type BrowserServerMessage,
  BrowserTabsResponse,
} from "@codeden/contracts";
import { findInstalledChannels, type LaunchedBrowser, launchChromium } from "@codeden/runner";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { type Harness, startHarness, TOKEN, waitUntil } from "./support/harness";

const hasBrowser = findInstalledChannels().length > 0;
const SECRET = "r".repeat(64);

const PAGE = `<!doctype html><title>Native test</title>
<button onclick="this.textContent='clicked'">Press me</button>
<script>if (location.pathname === '/set') document.cookie = 'who=native; path=/'</script>
<p id=c></p><script>c.textContent = document.cookie || 'none'</script>`;

class Viewer {
  readonly messages: BrowserServerMessage[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => this.messages.push(JSON.parse(d.toString()) as BrowserServerMessage));
  }
  static async connect(base: string, query: string): Promise<Viewer> {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/browser?${query}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
    return new Viewer(ws);
  }
  waitFor(pred: (m: BrowserServerMessage) => boolean, timeoutMs = 20_000) {
    return waitUntil(() => this.messages.find(pred), timeoutMs);
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
}

/**
 * Native views end to end on the server side (§17 Phase 2), with a stand-in for the desktop app:
 * it offers native views on `/ws/browser-host`, and its "relay" is a real Chromium behind a
 * `/cdp/<session>` path that checks the secret (the relay itself is tested in the desktop app).
 */
describe.skipIf(!hasBrowser)("native browser views through the desktop app (stand-in)", () => {
  let h: Harness;
  let site: Server;
  let siteUrl: string;
  let sessionId: string;
  let mcp: Client;
  let app: LaunchedBrowser;
  let relayServer: Server;
  let host: WebSocket;
  const hostMessages: BrowserHostServerMessage[] = [];

  beforeAll(async () => {
    site = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(PAGE);
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
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

    // The stand-in app: a Chromium whose CDP endpoint is reachable only with the secret.
    app = await launchChromium();
    const wss = new WebSocketServer({ noServer: true });
    relayServer = createServer();
    relayServer.on("upgrade", (req, socket, head) => {
      if (req.headers[BROWSER_RELAY_SECRET_HEADER] !== SECRET || !req.url?.startsWith("/cdp/")) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (client) => {
        const upstream = new WebSocket(app.cdpUrl, { perMessageDeflate: false });
        const queue: string[] = [];
        upstream.on("open", () => {
          for (const m of queue.splice(0)) upstream.send(m);
        });
        client.on("message", (d) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(String(d));
          else queue.push(String(d));
        });
        upstream.on("message", (d) => client.send(String(d)));
        client.on("close", () => upstream.close());
        upstream.on("close", () => client.close());
      });
    });
    await new Promise<void>((r) => relayServer.listen(0, "127.0.0.1", r));
    const relayPort = (relayServer.address() as AddressInfo).port;

    host = new WebSocket(`${h.server.url.replace("http", "ws")}/ws/browser-host`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await new Promise((resolve, reject) => host.once("open", resolve).once("error", reject));
    host.on("message", (d) => {
      const msg = JSON.parse(String(d)) as BrowserHostServerMessage;
      hostMessages.push(msg);
      if (msg.type === "attach") {
        const url = `ws://127.0.0.1:${relayPort}/cdp/${msg.sessionId}`;
        host.send(JSON.stringify({ type: "attached", id: msg.id, relay: { url, secret: SECRET } }));
      }
    });
    host.send(JSON.stringify({ type: "hello", version: "test" }));
    await waitUntil(() => h.server.services.browser.host.available || undefined);
  }, 90_000);

  afterAll(async () => {
    host?.close();
    await mcp?.close();
    await h?.close();
    relayServer?.close();
    await app?.browser.close().catch(() => undefined);
    site?.closeAllConnections();
    await new Promise((r) => site?.close(r));
  }, 30_000);

  const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
    (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
  const tabs = async () =>
    BrowserTabsResponse.parse((await h.api("GET", `/sessions/${sessionId}/browser/tabs`)).body);

  it("an agent opens the browser on the app's views; the desktop window gets no frames", async () => {
    const window = await Viewer.connect(h.server.url, `sessionId=${sessionId}&native=1`);
    await window.waitFor((m) => m.type === "state" && !m.open);
    const nav = await mcp.callTool({ name: "browser_navigate", arguments: { url: siteUrl } });
    expect(nav.isError).toBeFalsy();
    expect(text(nav)).toContain("Native test");
    expect(hostMessages.filter((m) => m.type === "attach")).toHaveLength(1);
    expect(await tabs()).toMatchObject({ open: true, engine: "native" });
    await window.waitFor(
      (m) => m.type === "state" && m.open && !m.watching && m.engine === "native",
    );
    await window.waitFor((m) => m.type === "agent" && m.acting);

    const snap = text(await mcp.callTool({ name: "browser_snapshot", arguments: {} }));
    const ref = /button "Press me" \[ref=(e\d+)\]/.exec(snap)?.[1];
    await mcp.callTool({ name: "browser_click", arguments: { ref } });
    expect(text(await mcp.callTool({ name: "browser_snapshot", arguments: {} }))).toContain(
      'button "clicked"',
    );
    expect(window.messages.some((m) => m.type === "frame")).toBe(false);
    window.ws.close();
  }, 60_000);

  it("a phone sees frames of the native view, fitted, and never resizes it", async () => {
    const width = async () =>
      text(
        await mcp.callTool({ name: "browser_evaluate", arguments: { expression: "innerWidth" } }),
      );
    const before = await width();
    const phone = await Viewer.connect(h.server.url, `sessionId=${sessionId}`);
    phone.send({ type: "viewport", width: 390, height: 844, deviceScaleFactor: 3, claim: true });
    await phone.waitFor((m) => m.type === "frame");
    const viewport = await phone.waitFor((m) => m.type === "viewport");
    expect(viewport).toMatchObject({ mine: false });
    expect(await width()).toBe(before);
    phone.ws.close();
  }, 60_000);

  it("moves to the runner's Chromium with its cookies when the app quits", async () => {
    await mcp.callTool({ name: "browser_navigate", arguments: { url: `${siteUrl}set` } });
    const window = await Viewer.connect(h.server.url, `sessionId=${sessionId}&native=1`);
    await window.waitFor((m) => m.type === "state" && m.open);
    host.send(
      JSON.stringify({
        type: "handoff",
        id: "quit-1",
        sessions: [
          {
            sessionId,
            tabs: [{ url: siteUrl, active: true }],
            cookies: [
              {
                name: "who",
                value: "native",
                domain: "127.0.0.1",
                path: "/",
                httpOnly: false,
                secure: false,
              },
            ],
          },
        ],
      }),
    );
    expect(
      await waitUntil(() => hostMessages.find((m) => m.type === "handoff.done"), 30_000),
    ).toEqual({ type: "handoff.done", id: "quit-1", failed: [] });
    expect(await tabs()).toMatchObject({ open: true, engine: "runner", tabs: [{ url: siteUrl }] });
    await window.waitFor((m) => m.type === "tabs" && m.engine === "runner");
    const cookie = await mcp.callTool({
      name: "browser_evaluate",
      arguments: { expression: "document.getElementById('c').textContent" },
    });
    expect(text(cookie)).toBe('"who=native"');
    window.ws.close();
  }, 60_000);
});
