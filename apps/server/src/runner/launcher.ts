import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunnerLock } from "@codeden/contracts";
import { ownNodeEnv } from "@codeden/providers";
import { isProcessAlive, readLiveRunnerLock } from "./lock";

/** How to start the runner process. */
export interface RunnerLaunchConfig {
  command: string;
  args: string[];
  /** Extra environment for the runner. */
  env?: Record<string, string>;
}

/**
 * Work out how to launch the runner when the caller didn't say:
 * - a bundle ships `runner.js` next to the server code;
 * - in the monorepo, run `apps/runner/src/main.ts` through tsx.
 */
export function defaultRunnerLaunch(extraArgs: string[] = []): RunnerLaunchConfig | undefined {
  const here = import.meta.dirname;
  const bundled = resolve(here, "runner.js");
  if (existsSync(bundled)) return { command: process.execPath, args: [bundled, ...extraArgs] };
  const source = resolve(here, "../../../runner/src/main.ts");
  if (existsSync(source)) {
    const tsx = import.meta.resolve("tsx");
    return { command: process.execPath, args: ["--import", tsx, source, ...extraArgs] };
  }
  return undefined;
}

/**
 * Start the runner as a detached process that outlives the server (§4.2).
 * Output goes to `<home>/logs/runner.log`.
 */
export function spawnRunner(config: RunnerLaunchConfig, home: string): number | undefined {
  const logs = join(home, "logs");
  mkdirSync(logs, { recursive: true });
  const log = openSync(join(logs, "runner.log"), "a");
  const env = { ...process.env, ...config.env, CODEDEN_HOME: home };
  const child = spawn(config.command, [...config.args, "--home", home], {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
    cwd: home,
    // In the desktop app `process.execPath` is the Electron binary: run it as Node.js (§17).
    env: config.command === process.execPath ? ownNodeEnv(env) : env,
  });
  child.unref();
  return child.pid;
}

/** True when `lock` belongs to the runner we spawned (or, without a pid, is not the stale one). */
function isFreshLock(
  lock: RunnerLock,
  spawnedPid: number | undefined,
  stale?: RunnerLock,
): boolean {
  if (spawnedPid !== undefined) return lock.pid === spawnedPid;
  return !stale || lock.pid !== stale.pid || lock.startedAt !== stale.startedAt;
}

/**
 * Spawn a runner and wait for the lock file it writes. Only the lock of the runner just
 * spawned is accepted: a stale lock whose pid happens to be alive would otherwise be returned
 * at once, fail to connect, and the retry would spawn a second runner that is never stopped.
 */
export async function startRunnerProcess(opts: {
  launch: RunnerLaunchConfig;
  home: string;
  lockFile: string;
  stale?: RunnerLock;
  timeoutMs: number;
}): Promise<RunnerLock> {
  const pid = spawnRunner(opts.launch, opts.home);
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    const lock = readLiveRunnerLock(opts.lockFile);
    if (lock && isFreshLock(lock, pid, opts.stale)) return lock;
  }
  if (pid !== undefined && isProcessAlive(pid)) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  throw new Error("Runner did not start in time (see logs/runner.log)");
}
