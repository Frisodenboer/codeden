import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve the data directory (§6): explicit value, then `CODEDEN_HOME`, then `~/.codeden`.
 * Two copies can run side by side with different homes and ports.
 */
export function resolveHome(explicit?: string): string {
  const fromEnv = process.env.CODEDEN_HOME;
  if (explicit) return resolve(explicit);
  if (fromEnv) return resolve(fromEnv);
  return join(homedir(), ".codeden");
}

/** Well-known paths inside the data directory. */
export function homePaths(home: string) {
  return {
    home,
    db: join(home, "codeden.db"),
    settings: join(home, "settings.json"),
    token: join(home, "install-token"),
    serverLock: join(home, "server.json"),
    runnerDir: join(home, "runner"),
    runnerLock: join(home, "runner", "runner.json"),
    worktrees: join(home, "wt"),
    artifacts: join(home, "artifacts"),
    logs: join(home, "logs"),
  };
}
export type HomePaths = ReturnType<typeof homePaths>;

/** Create the data directory layout if missing. */
export function ensureHome(home: string): HomePaths {
  const paths = homePaths(home);
  for (const dir of [paths.home, paths.runnerDir, paths.worktrees, paths.artifacts, paths.logs]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
