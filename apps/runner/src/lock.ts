import { readFileSync, rmSync } from "node:fs";
import { RunnerLock } from "@codeden/contracts";
import { isAlive } from "./process/tree";

/** Lock files owned by runners in this process (several embedded runners in tests). */
const activeLocks = new Set<string>();

export function readLock(lockFile: string): RunnerLock | undefined {
  try {
    const parsed = RunnerLock.safeParse(JSON.parse(readFileSync(lockFile, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Liveness check beyond "the pid exists": the runner answers `/health` with its token.
 * Guards against pid reuse after a crash left a stale lock file.
 */
export async function probeRunner(lock: RunnerLock, timeoutMs = 3_000): Promise<boolean> {
  if (!isAlive(lock.pid)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${lock.port}/health`, {
      headers: { authorization: `Bearer ${lock.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Throw when another live runner owns this home; claim the lock for this process. */
export async function assertSingleInstance(lockFile: string): Promise<void> {
  if (activeLocks.has(lockFile)) throw new Error("Another runner is already running for this home");
  const lock = readLock(lockFile);
  if (lock && lock.pid !== process.pid && (await probeRunner(lock))) {
    throw new Error(`Another runner (pid ${lock.pid}) is already running for this home`);
  }
  activeLocks.add(lockFile);
}

/** Remove the lock file if it still belongs to this process. */
export function removeOwnLock(lockFile: string): void {
  activeLocks.delete(lockFile);
  const current = readLock(lockFile);
  if (current?.pid === process.pid) rmSync(lockFile, { force: true });
}
