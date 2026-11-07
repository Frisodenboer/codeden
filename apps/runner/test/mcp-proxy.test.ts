import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunningRunner, startRunner } from "../src";
import { removeDir, TestServer, tempDir } from "./helpers";

interface Seen {
  method: string;
  auth: string | undefined;
  session: string | undefined;
  body: string;
}

/** A tiny Streamable-HTTP MCP endpoint: JSON replies, SSE replies, a GET stream and DELETE. */
function fakeUpstream(seen: Seen[]): Promise<{ server: Server; url: string }> {
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => {
        data += c;
      });
      req.on("end", () => resolve(data));
    });
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({
      method: req.method ?? "",
      auth: req.headers.authorization,
      session: req.headers["mcp-session-id"] as string | undefined,
      body,
    });
    if (req.headers.authorization !== "Bearer session-token") {
      res.writeHead(401, { "www-authenticate": "Bearer" }).end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n');
      setTimeout(() => {
        res.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/second"}\n\n');
        res.end();
      }, 150);
      return;
    }
    const msg = JSON.parse(body) as { id: number; method: string };
    if (msg.method === "initialize") {
      res
        .writeHead(200, { "content-type": "application/json", "mcp-session-id": "mcp-sess-1" })
        .end(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }),
        );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n`);
    setTimeout(() => {
      res.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } })}\n\n`);
    }, 100);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp` }),
    ),
  );
}

describe("local MCP proxy", () => {
  let home: string;
  let runner: RunningRunner;
  let upstream: { server: Server; url: string };
  const seen: Seen[] = [];

  beforeEach(async () => {
    seen.length = 0;
    home = tempDir("codeden-mcp-");
    upstream = await fakeUpstream(seen);
    runner = await startRunner({ home });
  });
  afterEach(async () => {
    await runner.close();
    upstream.server.closeAllConnections();
    await new Promise((r) => upstream.server.close(r));
    removeDir(home);
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(runner.mcpUrl, {
      method: "POST",
      headers: {
        authorization: "Bearer session-token",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it("is unavailable until configured, and requires a session token", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(503);
    const anonymous = await fetch(runner.mcpUrl, { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);
    // The runner token is not needed for /mcp, but the rest of the runner still requires it.
    expect((await fetch(`http://127.0.0.1:${runner.port}/health`)).status).toBe(401);
  });

  it("forwards JSON and SSE responses, GET streams and DELETE to the configured upstream", async () => {
    const server = await TestServer.attach(runner);
    const configured = await server.request({
      name: "runner.configure",
      mcpUpstreamUrl: upstream.url,
    });
    expect(configured.mcpProxyUrl).toBe(runner.mcpUrl);

    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBe("mcp-sess-1");
    expect(await init.json()).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18" } });

    const list = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { "mcp-session-id": "mcp-sess-1", "mcp-protocol-version": "2025-06-18" },
    );
    expect(list.headers.get("content-type")).toBe("text/event-stream");
    const text = await list.text();
    expect(text).toContain("notifications/progress");
    expect(text).toContain('"tools":[]');

    const stream = await fetch(runner.mcpUrl, {
      headers: {
        authorization: "Bearer session-token",
        accept: "text/event-stream",
        "mcp-session-id": "mcp-sess-1",
      },
    });
    const reader = stream.body?.getReader();
    const first = await reader?.read();
    // The first event arrives before the upstream finished the stream: it is not buffered.
    expect(new TextDecoder().decode(first?.value)).toContain("notifications/ping");
    let rest = "";
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(rest).toContain("notifications/second");

    const del = await fetch(runner.mcpUrl, {
      method: "DELETE",
      headers: { authorization: "Bearer session-token", "mcp-session-id": "mcp-sess-1" },
    });
    expect(del.status).toBe(204);

    const denied = await post(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { authorization: "Bearer wrong" },
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toBe("Bearer");

    expect(seen.map((s) => s.method)).toEqual(["POST", "POST", "GET", "DELETE", "POST"]);
    expect(seen[1]).toMatchObject({ session: "mcp-sess-1", auth: "Bearer session-token" });
    expect(seen.every((s) => !s.auth?.includes(runner.token))).toBe(true);
    await server.close();
  });

  it("reports an unreachable upstream as a JSON-RPC error", async () => {
    const server = await TestServer.attach(runner);
    await server.request({ name: "runner.configure", mcpUpstreamUrl: "http://127.0.0.1:1/mcp" });
    const res = await post({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
    await server.close();
  });
});
