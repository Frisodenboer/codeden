import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HealthResponse, ServerLock } from "@codeden/contracts";

/** Files the desktop app reads in the CodeDen home (same layout as the server's `homePaths`). */
export function homeFiles(home: string) {
  return {
    token: join(home, "install-token"),
    serverLock: join(home, "server.json"),
    runnerLock: join(home, "runner", "runner.json"),
    logs: join(home, "logs"),
    /** The app's Chromium profile, window state and logs live here, next to the data. */
    desktop: join(home, "desktop"),
  };
}

/** Either attach to a live server for this home (started by `codeden`), or start our own. */
export type ServerPlan = { kind: "attach"; lock: ServerLock } | { kind: "start" };

export interface PlanDeps {
  readLock(file: string): unknown;
  isAlive(pid: number): boolean;
  /** `/api/health` on that port answers as CodeDen. */
  healthy(port: number): Promise<boolean>;
}

/**
 * Decide how to get a server (§17): the same home as `npx codeden` means the same data, so a
 * server already running for it (lock file, live pid, answering `/api/health`) is reused;
 * otherwise the app starts one. A stale or unreadable lock means start.
 */
export async function planServer(home: string, deps: PlanDeps = defaultDeps): Promise<ServerPlan> {
  const parsed = ServerLock.safeParse(deps.readLock(homeFiles(home).serverLock));
  if (!parsed.success) return { kind: "start" };
  if (!deps.isAlive(parsed.data.pid)) return { kind: "start" };
  return (await deps.healthy(parsed.data.port))
    ? { kind: "attach", lock: parsed.data }
    : { kind: "start" };
}

/** The install token, or null when the home has none yet (the server creates it). */
export function readToken(home: string): string | null {
  try {
    const token = readFileSync(homeFiles(home).token, "utf8").trim();
    return token.length >= 32 ? token : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const defaultDeps: PlanDeps = {
  readLock(file) {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  },
  isAlive: isProcessAlive,
  async healthy(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return HealthResponse.safeParse(await res.json()).success;
    } catch {
      return false;
    }
  },
};
