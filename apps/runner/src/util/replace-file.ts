import { copyFileSync, renameSync, rmSync } from "node:fs";

/** Errors Windows gives while another program (antivirus, indexer, backup) has a file open. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const DELAYS_MS = [5, 10, 20, 40, 80, 120, 200];

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Move `tmp` over `dest`, as `renameSync` does, but get past the moments when Windows refuses
 * because another program briefly has `dest` open: retry for about half a second, then copy
 * the contents over instead. Throws only when all of that fails. Synchronous, like its callers.
 */
export function replaceFileSync(
  tmp: string,
  dest: string,
  fs: { rename: typeof renameSync; copy: typeof copyFileSync } = {
    rename: renameSync,
    copy: copyFileSync,
  },
  sleep: (ms: number) => void = sleepSync,
): void {
  let last: unknown;
  for (const delay of [0, ...DELAYS_MS]) {
    if (delay) sleep(delay);
    try {
      fs.rename(tmp, dest);
      return;
    } catch (error) {
      last = error;
      if (!BUSY.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  try {
    fs.copy(tmp, dest);
  } catch {
    throw last;
  }
  rmSync(tmp, { force: true });
}
