import { ensureInstallToken, homePaths, isProcessAlive, readLiveRunnerLock } from "@codeden/server";
import { findRunningServer } from "./running";

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
    // The server asks the runner to exit; fall back to killing it.
    if (!(await waitForExit(runner.pid, 5_000))) {
      process.kill(runner.pid);
      await waitForExit(runner.pid, 5_000);
    }
    console.log(`Stopped runner (pid ${runner.pid}).`);
  }
  return 0;
}
