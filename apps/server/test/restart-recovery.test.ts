import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isProcessAlive, type RunningServer, readLiveRunnerLock, startServer } from "../src";
import { RESTART_CONTINUE_MESSAGE } from "../src/services/sessions/recovery";

const TOKEN = "e".repeat(64);
let home: string;
let server: RunningServer;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "codeden-recover-"));
  server = await startServer({
    port: 0,
    dataDir: home,
    token: TOKEN,
    enableFakeProvider: true,
    waitForRunner: true,
    secrets: "memory",
    checkSetupOnStart: false,
    userHome: home,
  });
});

afterAll(async () => {
  const lock = readLiveRunnerLock(server.paths.runnerLock);
  await server.close({ stopRunner: true });
  const deadline = Date.now() + 10_000;
  while (lock && isProcessAlive(lock.pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function until<T>(check: () => T | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

it("resumes a turn cut off by a runner drain and tells the agent to continue", async () => {
  const s = server.services;
  // A long prompt keeps the Fake turn streaming for a few seconds (one delta per word).
  const prompt = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
  const started = await s.sessions.start({
    projectId: null,
    role: "orchestrator",
    provider: "fake",
    startedBy: { kind: "user" },
    workspace: { mode: "worktree" },
    input: { text: prompt, attachments: [] },
  });
  if (started.status !== "started") throw new Error(started.status);
  const id = started.sessionId;
  await until(() => s.sessionRepo.get(id).status === "running");
  const oldPid = readLiveRunnerLock(server.paths.runnerLock)?.pid;

  await server.runner?.request({
    name: "runner.drain",
    reason: "test restart",
    exitWhenDrained: true,
    timeoutMs: 100,
  });

  // A fresh runner takes over and the session is resumed with the continue message.
  await until(() => {
    const pid = readLiveRunnerLock(server.paths.runnerLock)?.pid;
    return pid !== undefined && pid !== oldPid && server.runner?.status.state === "connected";
  });
  const reply = await until(() => {
    const thread = s.sessionRepo.get(id).rootThreadId;
    if (!thread) return undefined;
    const page = s.sessionRepo.threadPage(id, thread, { limit: 200 });
    return page.items.find(
      (r) => r.item.kind === "assistant_message" && r.item.text.includes(RESTART_CONTINUE_MESSAGE),
    );
  }, 45_000);
  expect(reply).toBeTruthy();
  await until(() => s.sessionRepo.get(id).status === "idle");
  const types = s.store.listAfter(0, 100_000).map((e) => e.type);
  expect(types).toContain("runner.draining");
  expect(types).toContain("agent.turn.interrupted");
}, 90_000);
