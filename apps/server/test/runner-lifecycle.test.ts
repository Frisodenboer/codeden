import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEDEN_VERSION, SessionSnapshot } from "@codeden/contracts";
import { startRunner, stopRunner } from "@codeden/runner";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultRunnerLaunch,
  isProcessAlive,
  type RunningServer,
  readLiveRunnerLock,
  startServer,
} from "../src";
import { spawnRunner } from "../src/runner/launcher";

const TOKEN = "f".repeat(64);
const homes: string[] = [];
let server: RunningServer | undefined;

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "codeden-life-"));
  homes.push(home);
  return home;
}

async function waitUntil(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

afterEach(async () => {
  await server?.close({ stopRunner: true });
  server = undefined;
  for (const home of homes.splice(0)) {
    const lock = readLiveRunnerLock(join(home, "runner", "runner.json"));
    if (lock) await stopRunner(join(home, "runner", "runner.json"));
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe("runner lifecycle (real processes)", () => {
  it("survives the server process being killed and replays the events it missed", async () => {
    const home = newHome();
    // A long prompt makes the Fake turn stream for several seconds (one delta per word).
    const prompt = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        join(import.meta.dirname, "fixtures", "server-child.ts"),
        home,
        TOKEN,
        prompt,
      ],
      { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    const exited = new Promise((r) => child.once("exit", r));
    await waitUntil(() => out.includes("ready"), 30_000);

    const lockFile = join(home, "runner", "runner.json");
    const lock = readLiveRunnerLock(lockFile);
    expect(lock && lock.pid !== child.pid && lock.pid !== process.pid).toBe(true);
    child.kill("SIGKILL"); // a crash: TerminateProcess on Windows, no cleanup at all
    await exited;
    await new Promise((r) => setTimeout(r, 500));

    // The detached runner kept going without a server and journaled what happened.
    expect(isProcessAlive(lock?.pid ?? 0)).toBe(true);
    const journaled = readFileSync(join(home, "runner", "journal.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(journaled.length).toBeGreaterThan(0);

    server = await startServer({ port: 0, dataDir: home, token: TOKEN, waitForRunner: true });
    expect(readLiveRunnerLock(lockFile)?.pid).toBe(lock?.pid); // reattached, not respawned
    const store = server.store;
    await waitUntil(
      () =>
        store
          .listAfter(0, 100_000, ["s1"])
          .some(
            (e) =>
              e.type === "agent.turn.completed" &&
              (e.payload as { threadId: string }).threadId === "s1:thread-root",
          ),
      30_000,
    );
    const res = await fetch(`${server.url}/api/sessions/s1/snapshot`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const snapshot = SessionSnapshot.parse(await res.json());
    const reply = snapshot.items.find(
      (i) => i.threadId === "s1:thread-root" && i.item.kind === "assistant_message",
    );
    expect(reply?.item.kind === "assistant_message" && reply.item.text).toBe(`Echo: ${prompt}`);
    const status = await server.runner?.request({ name: "runner.status" });
    expect(status?.journal.unacked).toBe(0);
  }, 90_000);

  it("drains and replaces a runner of a different version", async () => {
    const home = newHome();
    let oldExited = false;
    const old = await startRunner({
      home,
      version: "0.0.0-old",
      enableFakeProvider: true,
      onShutdown: () => {
        oldExited = true;
      },
    });
    server = await startServer({
      port: 0,
      dataDir: home,
      token: TOKEN,
      enableFakeProvider: true,
      waitForRunner: true,
    });
    const client = server.runner;
    await waitUntil(() => oldExited, 20_000);
    await waitUntil(
      () => client?.status.state === "connected" && client.status.version === CODEDEN_VERSION,
      30_000,
    );
    const lock = readLiveRunnerLock(join(home, "runner", "runner.json"));
    expect(lock?.pid).not.toBe(process.pid);
    expect(lock?.version).toBe(CODEDEN_VERSION);
    const events = server.store.listAfter(0, 1000).map((e) => e.type);
    expect(events.filter((t) => t === "runner.connected")).toHaveLength(2);
    await old.close();
  }, 60_000);

  it("replaces a stale lock whose pid is alive but is not a runner", async () => {
    const home = newHome();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(home, "runner"), { recursive: true });
    // Our own pid is alive but nothing answers on this port with this token.
    writeFileSync(
      join(home, "runner", "runner.json"),
      JSON.stringify({
        pid: process.pid,
        port: 1,
        token: "x".repeat(32),
        version: CODEDEN_VERSION,
        protocolVersion: 1,
        runnerId: "stale",
        startedAt: new Date().toISOString(),
      }),
    );
    server = await startServer({ port: 0, dataDir: home, token: TOKEN, waitForRunner: true });
    const lock = readLiveRunnerLock(join(home, "runner", "runner.json"));
    expect(lock?.pid).not.toBe(process.pid);
    expect(server.runner?.status.state).toBe("connected");
  }, 60_000);

  it("stops a detached runner without a server (codeden stop)", async () => {
    const home = newHome();
    const launch = defaultRunnerLaunch();
    if (!launch) throw new Error("no runner launch config");
    spawnRunner(launch, home);
    const lockFile = join(home, "runner", "runner.json");
    await waitUntil(() => readLiveRunnerLock(lockFile) !== undefined, 30_000);
    const pid = readLiveRunnerLock(lockFile)?.pid;
    expect(await stopRunner(lockFile)).toBe(pid);
    expect(isProcessAlive(pid ?? 0)).toBe(false);
    expect(existsSync(lockFile)).toBe(false);
  }, 60_000);
});
