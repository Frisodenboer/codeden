import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEnvelope, SessionSnapshot } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isProcessAlive, type RunningServer, readLiveRunnerLock, startServer } from "../src";
import { sampleSession } from "./helpers";

const TOKEN = "e".repeat(64);
let home: string;
let server: RunningServer | undefined;

async function waitUntil(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "codeden-e2e-"));
});

afterAll(async () => {
  await server?.close({ stopRunner: true });
  rmSync(home, { recursive: true, force: true });
});

const start = () =>
  startServer({
    port: 0,
    dataDir: home,
    token: TOKEN,
    enableFakeProvider: true,
    waitForRunner: true,
    secrets: "memory",
    checkSetupOnStart: false,
  });

describe("server <-> runner", () => {
  it("starts a detached runner, runs a Fake session through it and stores the events", async () => {
    server = await start();
    const runner = server.runner;
    expect(runner?.status.state).toBe("connected");
    expect(runner?.status.providers.map((p) => p.id)).toContain("fake");
    const lock = readLiveRunnerLock(server.paths.runnerLock);
    expect(lock && lock.pid !== process.pid).toBe(true);

    server.store.append([
      { type: "session.created", sessionId: "s1", payload: { session: sampleSession } },
    ]);
    const result = await runner?.request({
      name: "session.start",
      sessionId: "s1",
      providerId: "fake",
      options: {
        sessionId: "s1",
        role: "agent",
        cwd: home,
        autonomy: "auto",
        mcpServers: [],
        additionalDirectories: [],
        planMode: false,
      },
      input: { text: "hello from the server [subagent]", attachments: [] },
    });
    expect(result?.resumeToken).toBe("fake-s1");

    const store = server.store;
    const completed = () =>
      store
        .listAfter(0, 10_000, ["s1"])
        .some(
          (e) =>
            e.type === "agent.turn.completed" &&
            (e.payload as { threadId: string }).threadId === "s1:thread-root",
        );
    await waitUntil(completed);

    const events = store.listAfter(0, 10_000).map((e) => EventEnvelope.parse(e));
    const types = events.map((e) => e.type);
    expect(types).toContain("runner.connected");
    expect(types).toContain("agent.item.delta");
    expect(types).toContain("agent.thread.started");

    const res = await fetch(`${server.url}/api/sessions/s1/snapshot`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const snapshot = SessionSnapshot.parse(await res.json());
    expect(snapshot.session.resumeToken).toBe("fake-s1");
    expect(snapshot.threads.some((t) => t.parentThreadId === "s1:thread-root")).toBe(true);
    const reply = snapshot.items.find(
      (i) => i.threadId === "s1:thread-root" && i.item.kind === "assistant_message",
    );
    expect(reply?.item.kind === "assistant_message" && reply.item.text).toBe(
      "Echo: hello from the server [subagent]",
    );
  });

  it("keeps the runner alive across a server restart and reattaches", async () => {
    const before = readLiveRunnerLock(server?.paths.runnerLock ?? "");
    const seqBefore = server?.store.headSeq() ?? 0;
    await server?.close();
    expect(before && isProcessAlive(before.pid)).toBe(true);

    server = await start();
    const after = readLiveRunnerLock(server.paths.runnerLock);
    expect(after?.pid).toBe(before?.pid);
    expect(server.runner?.status.runnerId).toBe(before?.runnerId);
    const status = await server.runner?.request({ name: "runner.status" });
    expect(status?.journal.unacked).toBe(0);
    // No agent events were re-imported: only the disconnect/reconnect markers were appended.
    const fresh = server.store.listAfter(seqBefore).map((e) => e.type);
    expect(fresh).toEqual(["runner.disconnected", "runner.connected"]);
  });

  it("stops the runner on request", async () => {
    const lock = readLiveRunnerLock(server?.paths.runnerLock ?? "");
    await server?.close({ stopRunner: true });
    server = undefined;
    await waitUntil(() => !lock || !isProcessAlive(lock.pid), 10_000);
  });
});
