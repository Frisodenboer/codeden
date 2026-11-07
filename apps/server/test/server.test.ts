import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentEventToNewEvent,
  type ServerToClientMessage,
  SessionSnapshot,
  Settings,
  Snapshot,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type RunningServer, startServer } from "../src";
import { sampleSessionEvent } from "./helpers";

const TOKEN = "t".repeat(64);
let home: string;
let server: RunningServer;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "codeden-server-"));
  server = await startServer({ port: 0, dataDir: home, token: TOKEN, runner: false });
});

afterEach(async () => {
  await server.close();
  rmSync(home, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };

describe("security", () => {
  it("serves health without a token", async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: "codeden" });
  });

  it("requires a token everywhere else", async () => {
    expect((await fetch(`${server.url}/api/snapshot`)).status).toBe(401);
    expect(
      (await fetch(`${server.url}/api/snapshot`, { headers: { authorization: "Bearer nope" } }))
        .status,
    ).toBe(401);
    expect((await fetch(`${server.url}/api/snapshot`, { headers: auth })).status).toBe(200);
  });

  it("exchanges ?token= for an HttpOnly SameSite=Strict cookie and strips it", async () => {
    const res = await fetch(`${server.url}/?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`codeden_token_${server.port}=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const withCookie = await fetch(`${server.url}/api/snapshot`, {
      headers: { cookie: cookie.split(";")[0] as string },
    });
    expect(withCookie.status).toBe(200);
  });

  it("rejects foreign origins and hosts", async () => {
    const evil = await fetch(`${server.url}/api/snapshot`, {
      headers: { ...auth, origin: "http://evil.example" },
    });
    expect(evil.status).toBe(403);
    const otherPort = await fetch(`${server.url}/api/snapshot`, {
      headers: { ...auth, origin: "http://localhost:1" },
    });
    expect(otherPort.status).toBe(403);
    const same = await fetch(`${server.url}/api/snapshot`, {
      headers: { ...auth, origin: server.url },
    });
    expect(same.status).toBe(200);
    // fetch() cannot override Host, so use node:http for the DNS-rebinding case.
    const rebind = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/api/health",
          headers: { host: "evil.example" },
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on("error", reject);
      req.end();
    });
    expect(rebind).toBe(403);
  });
});

describe("api", () => {
  it("returns a valid snapshot", async () => {
    const res = await fetch(`${server.url}/api/snapshot`, { headers: auth });
    const snapshot = Snapshot.parse(await res.json());
    expect(snapshot.runner.state).toBe("disabled");
    expect(snapshot.seq).toBe(0);
  });

  it("patches and persists settings", async () => {
    const res = await fetch(`${server.url}/api/settings`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ voice: { readAloud: { enabled: true } } }),
    });
    expect(res.status).toBe(200);
    const saved = Settings.parse(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")));
    expect(saved.voice.readAloud.enabled).toBe(true);
    expect(saved.voice.readAloud.engine).toBe("browser");
    const bad = await fetch(`${server.url}/api/settings`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ autonomy: { default: "reckless" } }),
    });
    expect(bad.status).toBe(400);
    expect(server.store.headSeq()).toBe(1);
  });

  it("projects agent events into a session snapshot", async () => {
    for (const e of sampleSessionEvent()) server.store.append([e]);
    const res = await fetch(`${server.url}/api/sessions/s1/snapshot`, { headers: auth });
    const snap = SessionSnapshot.parse(await res.json());
    expect(snap.session.rootThreadId).toBe("t1");
    expect(snap.turns[0]?.status).toBe("completed");
    const message = snap.items.find((i) => i.item.kind === "assistant_message");
    expect(message?.item.kind === "assistant_message" && message.item.text).toBe("Hello world");
    expect(
      (await fetch(`${server.url}/api/sessions/nope/snapshot`, { headers: auth })).status,
    ).toBe(404);
  });
});

describe("ui websocket", () => {
  it("catches up from a seq, then streams live events", async () => {
    const [first, ...rest] = sampleSessionEvent();
    server.store.append([first as (typeof rest)[number]]);
    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`, { headers: auth });
    const messages: ServerToClientMessage[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", fromSeq: 0 })));
      ws.on("error", reject);
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
        const seqs = messages.flatMap((m) =>
          m.type === "events" ? m.events.map((e) => e.seq) : [],
        );
        if (seqs.length === 1) server.store.append(rest);
        else if (seqs.at(-1) === server.store.headSeq()) resolve();
      });
    });
    ws.close();
    expect(messages[0]?.type).toBe("hello");
    const seqs = messages.flatMap((m) => (m.type === "events" ? m.events.map((e) => e.seq) : []));
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("asks clients ahead of the log to resync", async () => {
    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`, { headers: auth });
    const resync = await new Promise<ServerToClientMessage>((resolve, reject) => {
      ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", fromSeq: 99 })));
      ws.on("error", reject);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerToClientMessage;
        if (msg.type === "resync") resolve(msg);
      });
    });
    ws.close();
    expect(resync).toMatchObject({ type: "resync", reason: "server_restarted", seq: 0 });
  });

  it("rejects websocket upgrades without a token", async () => {
    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`);
    const status = await new Promise<number>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => {});
    });
    expect(status).toBe(401);
  });
});

it("keeps agent event persistence helpers consistent", () => {
  const e = agentEventToNewEvent("s1", { type: "turn.started", threadId: "t", turnId: "u" });
  expect(e.type).toBe("agent.turn.started");
});
