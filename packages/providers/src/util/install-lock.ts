import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";

export interface InstallLockOptions {
  /** A lock older than this is treated as abandoned (default 10 minutes). */
  staleMs?: number;
  /** Give up waiting for another holder after this long (default 10 minutes). */
  waitMs?: number;
  pollMs?: number;
  /** Called once when the lock is held by someone else and we start waiting. */
  onWait?: () => void;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** True when the lock file's holder is gone or the lock is older than `staleMs`. */
function isStale(file: string, staleMs: number): boolean {
  try {
    const age = Date.now() - statSync(file).mtimeMs;
    if (age > staleMs) return true;
    const pid = Number(JSON.parse(readFileSync(file, "utf8")).pid);
    return Number.isInteger(pid) && pid > 0 && !isAlive(pid);
  } catch {
    // Unreadable or half-written: only stale once it is old enough.
    return false;
  }
}

/**
 * A cross-process lock file (`open(..., "wx")`), so the server and the runner never run two
 * installs into the same folder. Waits while another live process holds it.
 * Returns the release function.
 */
export async function acquireInstallLock(
  file: string,
  opts: InstallLockOptions = {},
): Promise<() => void> {
  const staleMs = opts.staleMs ?? 600_000;
  const deadline = Date.now() + (opts.waitMs ?? 600_000);
  let waiting = false;
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (isStale(file, staleMs)) {
      rmSync(file, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for another install to finish");
    if (!waiting) {
      waiting = true;
      opts.onWait?.();
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 500));
  }
}
