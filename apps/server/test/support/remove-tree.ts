import { rmSync } from "node:fs";

/**
 * Delete a test's temp folder, retrying while Windows still holds it. A runner or fake process
 * that just exited keeps its working directory busy for a moment after its pid is gone, and
 * `rmSync`'s own `maxRetries` has not been enough on Node 24 (EPERM on the folder itself).
 */
export async function removeTree(path: string, attempts = 40): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
