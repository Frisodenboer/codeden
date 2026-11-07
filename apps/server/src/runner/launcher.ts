import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";

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
  const child = spawn(config.command, [...config.args, "--home", home], {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
    cwd: home,
    env: { ...process.env, ...config.env, CODEDEN_HOME: home },
  });
  child.unref();
  return child.pid;
}
