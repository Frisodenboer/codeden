import { stopRunner } from "@codeden/runner";
import { ensureInstallToken, homePaths, isProcessAlive, readLiveRunnerLock } from "@codeden/server";
import { findRunningServer } from "./running";

/** How long to keep watching for a runner the server was starting as it shut down. */
const LATE_RUNNER_MS = 2_000;

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isProcessAlive(pid);
}

/** `codeden stop`: stop the server and the runner for this home. */
export async function stop(home: string): Promise<number> {
  const paths = homePaths(home);
  const server = await findRunningServer(paths.serverLock);
  const runner = readLiveRunnerLock(paths.runnerLock);
  if (!server && !runner) {
    console.log("CodeDen is not running.");
    return 0;
  }
  if (server) {
    const token = ensureInstallToken(paths.token);
    await fetch(`http://127.0.0.1:${server.port}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ stopRunner: true }),
    }).catch(() => undefined);
    const exited = await waitForExit(server.pid, 10_000);
    console.log(
      exited ? `Stopped server (pid ${server.pid}).` : `Server (pid ${server.pid}) did not exit.`,
    );
  }
  if (runner) {
    // The server asks the runner to exit; otherwise ask it directly, then kill its process tree.
    if (!(await waitForExit(runner.pid, 5_000))) await stopRunner(paths.runnerLock);
    console.log(`Stopped runner (pid ${runner.pid}).`);
  }
  // A server stopped while it was replacing its runner (an upgrade drain, a reconnect) may
  // have spawned a new one that it never connected to: that one is detached and would
  // otherwise outlive everything. Stop whatever runner the lock names now.
  const deadline = Date.now() + LATE_RUNNER_MS;
  while (Date.now() < deadline) {
    const late = readLiveRunnerLock(paths.runnerLock);
    if (late && late.pid !== runner?.pid) {
      await stopRunner(paths.runnerLock);
      console.log(`Stopped runner (pid ${late.pid}).`);
      break;
    }
    if (!late && !server) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 0;
}
