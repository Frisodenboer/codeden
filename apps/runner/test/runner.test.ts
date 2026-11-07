import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RUNNER_PROTOCOL_VERSION,
  RunnerLock,
  type RunnerToServerMessage,
  RunnerToServerMessage as RunnerToServerSchema,
  type ServerToRunnerMessage,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Journal, type RunningRunner, startRunner } from "../src";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "codeden-runner-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("Journal", () => {
  it("assigns seqs, survives reloads and drops acked events", () => {
    const dir = join(home, "runner");
    const journal = new Journal(dir);
    const id = journal.runnerId;
    journal.append({ kind: "runner.draining", reason: "a" });
    journal.append({ kind: "runner.draining", reason: "b" });
    journal.append({ kind: "runner.draining", reason: "c" });
    journal.ack(1);

    const reloaded = new Journal(dir);
    expect(reloaded.runnerId).toBe(id);
    expect(reloaded.lastSeq).toBe(3);
    expect(reloaded.after(0).map((e) => e.seq)).toEqual([2, 3]);
    reloaded.ack(3);
    expect(new Journal(dir).unacked).toBe(0);
    expect(new Journal(dir).append({ kind: "runner.draining", reason: "d" }).seq).toBe(4);
  });
});

/** Minimal protocol client for tests. */
class TestServer {
  readonly messages: RunnerToServerMessage[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (d) =>
      this.messages.push(RunnerToServerSchema.parse(JSON.parse(d.toString()))),
    );
  }

  static async connect(runner: RunningRunner): Promise<TestServer> {
    const ws = new WebSocket(`ws://127.0.0.1:${runner.port}/runner`, {
      headers: { authorization: `Bearer ${runner.token}` },
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new TestServer(ws);
  }

  send(msg: ServerToRunnerMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor<T extends RunnerToServerMessage>(
    pred: (m: RunnerToServerMessage) => m is T,
  ): Promise<T>;
  async waitFor(pred: (m: RunnerToServerMessage) => boolean): Promise<RunnerToServerMessage>;
  async waitFor(pred: (m: RunnerToServerMessage) => boolean): Promise<RunnerToServerMessage> {
    for (let i = 0; i < 400; i++) {
      const found = this.messages.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("timed out waiting for message");
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

const sessionStart = (sessionId: string): ServerToRunnerMessage => ({
  type: "command",
  id: `start-${sessionId}`,
  command: {
    name: "session.start",
    sessionId,
    providerId: "fake",
    options: {
      sessionId,
      role: "agent",
      cwd: home,
      autonomy: "auto",
      mcpServers: [],
      additionalDirectories: [],
      planMode: false,
    },
    input: { text: "hello", attachments: [] },
  },
});

const isTurnCompleted = (m: RunnerToServerMessage) =>
  m.type === "event" && m.event.kind === "agent" && m.event.event.type === "turn.completed";

describe("runner", () => {
  it("writes a lock file and rejects unauthenticated connections", async () => {
    const runner = await startRunner({ home, enableFakeProvider: true });
    const lock = RunnerLock.parse(JSON.parse(readFileSync(runner.lockFile, "utf8")));
    expect(lock).toMatchObject({ pid: process.pid, port: runner.port, token: runner.token });
    expect(lock.providers).toEqual(["fake"]);
    const res = await fetch(`http://127.0.0.1:${runner.port}/health`);
    expect(res.status).toBe(401);
    await expect(startRunner({ home })).rejects.toThrow(/already running/);
    await runner.close();
    expect(() => readFileSync(runner.lockFile)).toThrow();
  });

  it("handshakes, runs a Fake session and replays unacked events after reconnect", async () => {
    const runner = await startRunner({ home, enableFakeProvider: true });
    const server = await TestServer.connect(runner);
    server.send({ type: "hello", protocolVersion: RUNNER_PROTOCOL_VERSION, serverVersion: "test" });
    const welcome = await server.waitFor((m) => m.type === "welcome");
    expect(welcome.type === "welcome" && welcome.providers.map((p) => p.id)).toEqual(["fake"]);
    server.send({ type: "resume", lastAckedSeq: 0 });

    server.send(sessionStart("s1"));
    const result = await server.waitFor((m) => m.type === "result");
    expect(result).toMatchObject({ ok: true, result: { resumeToken: "fake-s1" } });
    await server.waitFor(isTurnCompleted);

    const events = server.messages.flatMap((m) => (m.type === "event" ? [m] : []));
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    // Ack only the first half, then drop the connection.
    const half = Math.floor(events.length / 2);
    server.send({ type: "ack", seq: half });
    await new Promise((r) => setTimeout(r, 50));
    await server.close();

    const again = await TestServer.connect(runner);
    again.send({ type: "hello", protocolVersion: RUNNER_PROTOCOL_VERSION, serverVersion: "test" });
    const welcome2 = await again.waitFor((m) => m.type === "welcome");
    expect(welcome2.type === "welcome" && welcome2.sessions.map((s) => s.sessionId)).toEqual([
      "s1",
    ]);
    again.send({ type: "resume", lastAckedSeq: half });
    await again.waitFor(isTurnCompleted);
    const replayed = again.messages.flatMap((m) => (m.type === "event" ? [m.seq] : []));
    expect(replayed[0]).toBe(half + 1);
    expect(replayed.at(-1)).toBe(events.at(-1)?.seq);

    await again.close();
    await runner.close();
  });

  it("rejects incompatible protocol versions and unknown commands fail cleanly", async () => {
    const runner = await startRunner({ home });
    const server = await TestServer.connect(runner);
    server.send({ type: "hello", protocolVersion: 999, serverVersion: "future" });
    const reject = await server.waitFor((m) => m.type === "reject");
    expect(reject).toMatchObject({ reason: "protocol_mismatch" });
    server.send({ type: "command", id: "x", command: { name: "browser.close", sessionId: "s" } });
    const result = await server.waitFor((m) => m.type === "result");
    expect(result).toMatchObject({ ok: false, error: { code: "not_implemented" } });
    server.send(sessionStart("s2"));
    const failed = await server.waitFor((m) => m.type === "result" && m.id === "start-s2");
    expect(failed).toMatchObject({ ok: false, error: { code: "unknown_provider" } });
    await server.close();
    await runner.close();
  });
});
