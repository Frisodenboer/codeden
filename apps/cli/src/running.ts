import { readFileSync } from "node:fs";
import { HealthResponse, ServerLock } from "@codeden/contracts";
import { isProcessAlive } from "@codeden/server";

/** The server recorded in `<home>/server.json`, if it is alive and answering. */
export async function findRunningServer(lockFile: string): Promise<ServerLock | undefined> {
  let lock: ServerLock;
  try {
    lock = ServerLock.parse(JSON.parse(readFileSync(lockFile, "utf8")));
  } catch {
    return undefined;
  }
  if (!isProcessAlive(lock.pid)) return undefined;
  try {
    const res = await fetch(`http://127.0.0.1:${lock.port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return HealthResponse.safeParse(await res.json()).success ? lock : undefined;
  } catch {
    return undefined;
  }
}
