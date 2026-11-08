import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunnerLaunchConfig, startRunnerProcess } from "../src/runner/launcher";
import { isProcessAlive } from "../src/runner/lock";
import { removeTree } from "./support/remove-tree";

const homes: string[] = [];
const pids: number[] = [];

afterEach(async () => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
    // Windows keeps the home folder (the process's cwd) busy until the process is gone.
    const deadline = Date.now() + 10_000;
    while (isProcessAlive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  for (const home of homes.splice(0)) await removeTree(home);
});

/** The error a start that must fail rejects with. */
const failure = (start: Promise<unknown>): Promise<Error> =>
  start.then(
    () => {
      throw new Error("the runner start should have failed");
    },
    (error: unknown) => error as Error,
  );

function setup(env: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "codeden-start-"));
  homes.push(home);
  const launch: RunnerLaunchConfig = {
    command: process.execPath,
    args: [join(import.meta.dirname, "fixtures", "fake-runner.mjs")],
    env,
  };
  return { home, launch, lockFile: join(home, "runner", "runner.json") };
}

describe("starting the runner process (#14)", () => {
  it("waits for a slow runner instead of killing it, and notes that it is slow", async () => {
    const { home, launch, lockFile } = setup({
      FAKE_RUNNER_MODE: "slow",
      FAKE_RUNNER_DELAY_MS: "1500",
    });
    const slow: number[] = [];
    const lock = await startRunnerProcess({
      launch,
      home,
      lockFile,
      timeouts: { slowAfterMs: 200, timeoutMs: 60_000 },
      onSlow: ({ elapsedMs }) => slow.push(elapsedMs),
    });
    pids.push(lock.pid);
    expect(lock.runnerId).toBe("fake-runner");
    expect(isProcessAlive(lock.pid)).toBe(true);
    expect(slow).toHaveLength(1);
    expect(slow[0]).toBeGreaterThanOrEqual(200);
  }, 30_000);

  it("fails fast with the end of runner.log when the runner exits during start-up", async () => {
    const { home, launch, lockFile } = setup({ FAKE_RUNNER_MODE: "crash" });
    const started = Date.now();
    const error = await failure(
      startRunnerProcess({
        launch,
        home,
        lockFile,
        timeouts: { slowAfterMs: 60_000, timeoutMs: 60_000 },
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/exited during start-up \(exit 3\)/);
    expect(error.message).toContain("boom, cannot load the provider registry");
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(existsSync(lockFile)).toBe(false);
  }, 30_000);

  it("gives up on a runner that never writes its lock only after the upper bound, and stops it", async () => {
    const { home, launch, lockFile } = setup({ FAKE_RUNNER_MODE: "hang" });
    let slowPid: number | undefined;
    const error = await failure(
      startRunnerProcess({
        launch,
        home,
        lockFile,
        timeouts: { slowAfterMs: 100, timeoutMs: 1_000 },
        onSlow: ({ pid }) => {
          slowPid = pid;
          if (pid) pids.push(pid);
        },
      }),
    );
    expect(error.message).toMatch(/did not start within 1 s/);
    expect(slowPid).toBeDefined();
    const deadline = Date.now() + 10_000;
    while (isProcessAlive(slowPid ?? 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(isProcessAlive(slowPid ?? 0)).toBe(false);
  }, 30_000);
});
