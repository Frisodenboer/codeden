import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AgentEvent, type SessionOptions } from "@codeden/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { OpencodeClient } from "../src/opencode/client";
import { OpencodeSession } from "../src/opencode/session";
import type { OcEvent } from "../src/opencode/types";

/** The recorded GLM run (write hello.txt, run `ls`, answer "done"). */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/opencode/basic-events.json", import.meta.url), "utf8"),
) as OcEvent[];
const SESSION = "ses_e3558f5a4ffepFXzkQ3QSA66z4";

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | undefined;
}

/**
 * A fake `opencode serve`: the endpoints the adapter uses, with an event stream that replays
 * the recorded run when a prompt arrives and reports an abort as opencode does.
 */
async function fakeOpencode(opts: { replay?: boolean } = {}) {
  const calls: Call[] = [];
  const streams = new Set<ServerResponse>();
  const send = (event: object) => {
    for (const res of streams) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const replied = new Set<string>();
  const replay = async () => {
    for (const e of fixture) {
      send(e);
      if (e.type === "permission.asked") {
        const id = e.properties.id;
        for (let i = 0; i < 200 && !replied.has(id); i++)
          await new Promise((r) => setTimeout(r, 10));
      }
    }
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({
        method: req.method ?? "",
        path: url.pathname,
        body,
        auth: req.headers.authorization,
      });
      const json = (value: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const p = url.pathname;
      if (p === "/event") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        streams.add(res);
        res.on("close", () => streams.delete(res));
        res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
        return;
      }
      if (p === "/global/health") return json({ healthy: true, version: "1.18.30" });
      if (p === "/mcp") return json({ [body.name]: { status: "connected" } });
      if (p === "/session" && req.method === "POST") {
        return json({ id: SESSION, directory: url.searchParams.get("directory") });
      }
      if (p === `/session/${SESSION}`) return json({ id: SESSION, directory: "C:\\work" });
      if (p === `/session/${SESSION}/prompt_async`) {
        res.writeHead(204).end();
        // Like opencode, the run waits at each permission request until it is answered.
        if (opts.replay !== false) void replay();
        return;
      }
      if (p === `/session/${SESSION}/abort`) {
        json(true);
        send({
          type: "session.error",
          properties: {
            sessionID: SESSION,
            error: { name: "MessageAbortedError", data: { message: "Aborted" } },
          },
        });
        send({ type: "session.idle", properties: { sessionID: SESSION } });
        return;
      }
      if (p.startsWith("/permission/")) {
        replied.add(decodeURIComponent(p.split("/")[2] ?? ""));
        return json(true);
      }
      if (p === "/command") return json([]);
      res.writeHead(404).end("not found");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new OpencodeClient({ url, password: "pw" });
  return {
    calls,
    send,
    fakeServer: { client: async () => client, running: true, onExit: () => () => {} },
    close: () =>
      new Promise<void>((r) => {
        for (const s of streams) s.end();
        server.close(() => r());
      }),
  };
}

const options = (over: Partial<SessionOptions> = {}): SessionOptions => ({
  sessionId: "0193c3f2-aaaa-bbbb-cccc-1234567890ab",
  role: "agent",
  cwd: "C:\\work",
  autonomy: "auto",
  mcpServers: [],
  additionalDirectories: [],
  planMode: false,
  ...over,
});

/** Collect events until `until` matches one, failing after a while. */
async function collect(
  session: OpencodeSession,
  until: (e: AgentEvent) => boolean,
  onEvent?: (e: AgentEvent) => void,
) {
  const seen: AgentEvent[] = [];
  const it = session.events[Symbol.asyncIterator]();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const next = await Promise.race([
      it.next(),
      new Promise<IteratorResult<AgentEvent>>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 5000),
      ),
    ]);
    if (next.done) break;
    const e = AgentEvent.parse(next.value);
    seen.push(e);
    onEvent?.(e);
    if (until(e)) return seen;
  }
  throw new Error(`no matching event; saw ${seen.map((e) => e.type).join(" ")}`);
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("OpencodeSession against a fake opencode server", () => {
  it("runs a turn under Auto: MCP, rules, system prompt, policy approvals", async () => {
    const fake = await fakeOpencode();
    cleanup = fake.close;
    const session = new OpencodeSession(
      options({
        model: "zai-coding-plan/glm-5.3-flash",
        effort: "low",
        systemPrompt: "You run inside CodeBench.",
        mcpServers: [
          {
            transport: "http",
            name: "codeden",
            url: "http://127.0.0.1:1/mcp",
            headers: { Authorization: "Bearer t" },
            toolTimeoutSec: 600,
            trusted: true,
          },
        ],
      }),
      { server: fake.fakeServer, modelEfforts: () => ["low", "high", "max"] },
    );
    await session.start();
    expect(session.resumeToken()).toBe(SESSION);
    await session.send({ text: "go", attachments: [] });
    const events = await collect(
      session,
      (e) => e.type === "turn.completed" || e.type === "turn.failed",
    );
    await session.close();

    expect(events.at(-1)?.type).toBe("turn.completed");
    // Both permission requests (write in the worktree, `ls`) were approved by policy.
    const decided = events.flatMap((e) =>
      e.type === "item.completed" && e.item.kind === "approval_request" ? [e.item] : [],
    );
    expect(decided.map((d) => [d.decidedBy, d.decision])).toEqual([
      ["policy", "allow_once"],
      ["policy", "allow_once"],
    ]);
    const replies = fake.calls.filter((c) => c.path.startsWith("/permission/"));
    expect(replies.map((c) => (c.body as { reply: string }).reply)).toEqual(["once", "once"]);

    const mcp = fake.calls.find((c) => c.path === "/mcp");
    expect(mcp?.body).toMatchObject({
      name: "codeden-567890ab",
      config: { type: "remote", oauth: false },
    });
    const created = fake.calls.find((c) => c.path === "/session" && c.method === "POST");
    expect(
      (created?.body as { permission?: { permission: string; action: string }[] } | undefined)
        ?.permission,
    ).toContainEqual({
      permission: "codeden-567890ab_*",
      pattern: "*",
      action: "allow",
    });
    const prompt = fake.calls.find((c) => c.path.endsWith("/prompt_async"));
    expect(prompt?.body).toMatchObject({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" },
      variant: "low",
      system: "You run inside CodeBench.",
    });
    expect(
      fake.calls.every((c) => c.auth === `Basic ${Buffer.from("opencode:pw").toString("base64")}`),
    ).toBe(true);
  });

  it("asks the user under Supervised and passes the answer on", async () => {
    const fake = await fakeOpencode();
    cleanup = fake.close;
    const session = new OpencodeSession(options({ autonomy: "supervised" }), {
      server: fake.fakeServer,
    });
    await session.start();
    await session.send({ text: "go", attachments: [] });
    const events = await collect(
      session,
      (e) => e.type === "turn.completed",
      (e) => {
        if (e.type === "item.started" && e.item.kind === "approval_request") {
          void session.respond(e.item.requestId, {
            kind: "approval",
            decision: "deny",
            message: "no",
          });
        }
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    await session.close();
    expect(
      events.some((e) => e.type === "item.started" && e.item.kind === "approval_request"),
    ).toBe(true);
    const replies = fake.calls.filter((c) => c.path.startsWith("/permission/"));
    expect(replies.map((c) => c.body)).toEqual([
      { reply: "reject", message: "no" },
      { reply: "reject", message: "no" },
    ]);
  });

  it("resumes an existing session with today's rules and reports an interrupt", async () => {
    const fake = await fakeOpencode({ replay: false });
    cleanup = fake.close;
    const session = new OpencodeSession(options({ resumeToken: SESSION }), {
      server: fake.fakeServer,
    });
    await session.start();
    expect(fake.calls.some((c) => c.method === "PATCH" && c.path === `/session/${SESSION}`)).toBe(
      true,
    );
    // The fake never finishes this turn on its own: interrupt it.
    const origin = fake.calls.length;
    await session.send({ text: "go", attachments: [] });
    await session.interrupt();
    const events = await collect(
      session,
      (e) => e.type === "turn.interrupted" || e.type === "turn.completed",
    );
    await session.close();
    expect(fake.calls.slice(origin).some((c) => c.path.endsWith("/abort"))).toBe(true);
    expect(events.some((e) => e.type === "turn.interrupted")).toBe(true);
  });
});
