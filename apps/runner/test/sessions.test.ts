import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RunnerCommandOf, RunnerToServerMessage } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAlive, ProcessSupervisor, type RunningRunner, startRunner } from "../src";
import { parseLsof, parseNetstat } from "../src/ports";
import { parseProcessTable } from "../src/process/tree";
import { makeRepo, removeDir, TestServer, tempDir, waitUntil, write } from "./helpers";

let home: string;
let runner: RunningRunner;
let server: TestServer;
const cleanup: string[] = [];

beforeEach(async () => {
  home = tempDir("codeden-sessions-");
  runner = await startRunner({ home, enableFakeProvider: true });
  server = await TestServer.attach(runner);
});
afterEach(async () => {
  await server.close();
  await runner.close();
  removeDir(home);
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const start = (
  sessionId: string,
  cwd: string,
  text?: string,
): RunnerCommandOf<"session.start"> => ({
  name: "session.start",
  sessionId,
  providerId: "fake",
  options: {
    sessionId,
    role: "agent",
    cwd,
    autonomy: "auto",
    mcpServers: [],
    additionalDirectories: [],
    planMode: false,
  },
  ...(text ? { input: { text, attachments: [] } } : {}),
});

const turnCompleted = (sessionId: string) => (m: RunnerToServerMessage) =>
  m.type === "event" &&
  m.event.kind === "agent" &&
  m.event.sessionId === sessionId &&
  m.event.event.type === "turn.completed" &&
  m.event.event.threadId === `${sessionId}:thread-root`;

const checkpointsOf = (sessionId: string) =>
  server
    .events()
    .flatMap((m) =>
      m.event.kind === "checkpoint.created" && m.event.sessionId === sessionId ? [m.event] : [],
    );

describe("session hosting", () => {
  it("runs several sessions concurrently with ordered seqs", async () => {
    const ids = ["a", "b", "c"];
    await Promise.all(ids.map((id) => server.request(start(id, home, `hello ${id}`))));
    await Promise.all(ids.map((id) => server.waitFor(turnCompleted(id), 20_000)));
    const seqs = server.events().map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    for (const id of ids) {
      const kinds = server
        .events()
        .filter(
          (e) =>
            "sessionId" in e.event &&
            e.event.sessionId === id &&
            e.event.kind === "session.process",
        )
        .map((e) => (e.event.kind === "session.process" ? e.event.state : ""));
      expect(kinds).toEqual(["starting", "ready"]);
    }
    // Not a git repo: no checkpoints.
    expect(checkpointsOf("a")).toEqual([]);
    const status = await server.request({ name: "runner.status" });
    expect(status.sessions.map((s) => s.sessionId).sort()).toEqual(ids);
    await server.request({ name: "session.stop", sessionId: "b" });
    await server.waitFor(
      (m) =>
        m.type === "event" &&
        m.event.kind === "session.process" &&
        m.event.sessionId === "b" &&
        m.event.state === "exited",
    );
  });

  it("writes a baseline checkpoint and one per turn in a git worktree", async () => {
    const repo = makeRepo();
    cleanup.push(repo);
    await server.request(start("cp", repo, "first"));
    await server.waitFor(turnCompleted("cp"), 20_000);
    await waitUntil(() => checkpointsOf("cp").length === 2);
    write(repo, "agent-made.txt", "work\n");
    await server.request({
      name: "session.send",
      sessionId: "cp",
      input: { text: "second", attachments: [] },
    });
    await waitUntil(() => checkpointsOf("cp").length === 3, 20_000);
    const cps = checkpointsOf("cp");
    expect(cps.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(cps[0]?.turnId).toBeUndefined();
    expect(cps[2]?.turnId).toBeDefined();

    const turn2 = await server.request({
      name: "checkpoint.diff",
      cwd: repo,
      sessionId: "cp",
      from: 1,
      to: 2,
    });
    expect(turn2.files.map((f) => f.path)).toEqual(["agent-made.txt"]);
    const list = await server.request({ name: "checkpoint.list", cwd: repo, sessionId: "cp" });
    expect(list.checkpoints.map((c) => c.index)).toEqual([0, 1, 2]);
    const restored = await server.request({
      name: "checkpoint.restoreFiles",
      cwd: repo,
      sessionId: "cp",
      index: 0,
    });
    expect(restored.deleted).toEqual(["agent-made.txt"]);
  });

  it("fails cleanly for an unregistered provider and for unknown sessions", async () => {
    await expect(
      server.request({ ...start("x", home), providerId: "claude" }),
    ).rejects.toMatchObject({
      code: "unknown_provider",
      message: expect.stringContaining("available: fake"),
    });
    await expect(
      server.request({
        name: "session.send",
        sessionId: "nope",
        input: { text: "hi", attachments: [] },
      }),
    ).rejects.toMatchObject({ code: "unknown_session" });
  });

  it("drains: waits for running turns, refuses new work, then exits", async () => {
    let shutdown = false;
    await server.close();
    await runner.close();
    runner = await startRunner({
      home,
      enableFakeProvider: true,
      onShutdown: () => {
        shutdown = true;
      },
    });
    server = await TestServer.attach(runner);
    await server.request(start("d1", home, "long turn"));
    await server.request({
      name: "runner.drain",
      reason: "upgrade",
      exitWhenDrained: true,
      timeoutMs: 20_000,
    });
    await expect(server.request(start("d2", home, "late"))).rejects.toMatchObject({
      code: "draining",
    });
    await waitUntil(() => shutdown, 30_000);
    const events = server.events().map((e) => e.event);
    const drainIdx = events.findIndex((e) => e.kind === "runner.draining");
    const completedIdx = events.findIndex(
      (e) => e.kind === "agent" && e.event.type === "turn.completed",
    );
    expect(drainIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(drainIdx); // the turn finished after the drain began
    expect(
      events.some(
        (e) => e.kind === "session.process" && e.sessionId === "d1" && e.state === "exited",
      ),
    ).toBe(true);
  });
});

describe("process supervision", () => {
  it("kills a whole process tree, including grandchildren", async () => {
    const supervisor = new ProcessSupervisor();
    // child.cjs spawns a long-running grandchild and keeps running itself.
    write(
      home,
      "child.cjs",
      [
        "const { spawn } = require('child_process');",
        "const code = \"console.log('gc:' + process.pid); setInterval(() => {}, 1000)\";",
        "spawn(process.execPath, ['-e', code], { stdio: 'inherit' });",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    let out = "";
    const run = supervisor.runShell(`"${process.execPath}" child.cjs`, {
      cwd: home,
      onOutput: (c) => {
        out += c;
      },
    });
    await waitUntil(() => /gc:\d+/.test(out), 15_000);
    const gc = Number(/gc:(\d+)/.exec(out)?.[1]);
    expect(isAlive(gc)).toBe(true);
    expect(supervisor.list()).toHaveLength(1);
    await supervisor.killUnder(home);
    const result = await run;
    expect(result.exitCode).not.toBe(0);
    await waitUntil(() => !isAlive(gc), 10_000);
    expect(supervisor.list()).toHaveLength(0);
  }, 30_000);

  it("parses process and socket tables", () => {
    expect(parseProcessTable("  10   1\n  11  10\n12 10\nbad\n").get(10)).toEqual([11, 12]);
    expect(
      parseNetstat(
        [
          "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100",
          "  TCP    127.0.0.1:5173         0.0.0.0:0              ABHÖREN         4242",
          "  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4242",
          "  TCP    [::1]:3000             [::]:0                 LISTENING       77",
          "  UDP    0.0.0.0:500            *:*                                    9",
        ].join("\r\n"),
      ),
    ).toEqual([
      { address: "0.0.0.0", port: 135, pid: 1100 },
      { address: "127.0.0.1", port: 5173, pid: 4242 },
      { address: "[::1]", port: 3000, pid: 77 },
    ]);
    expect(parseLsof("p42\nn127.0.0.1:5173\nn*:3000\np7\nn[::1]:8080\n")).toEqual([
      { address: "127.0.0.1", port: 5173, pid: 42 },
      { address: "*", port: 3000, pid: 42 },
      { address: "[::1]", port: 8080, pid: 7 },
    ]);
  });

  it("discovers probed dev-server ports", async () => {
    const http = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    const port = (http.address() as AddressInfo).port;
    const result = await server.request({ name: "ports.list", probe: [port, 1] });
    expect(result.ports).toEqual([{ port, pid: process.pid, url: `http://localhost:${port}` }]);
    await new Promise((r) => http.close(r));
  }, 30_000);
});
