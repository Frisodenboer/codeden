import { type ChildProcess, spawn } from "node:child_process";
import { HealthResponse } from "@codeden/contracts";
import { applyRollback, cliEntry, type RunningServer, writeUpdateResult } from "@codeden/server";
import type { LaunchInfo } from "./launcher";

/** How long the new version has to answer `/api/health` before we stop watching it. */
const HEALTH_TIMEOUT_MS = 90_000;

/**
 * Arguments for the next server: the original ones with `--port` pinned to the port in use (so
 * the browser's URL and cookie keep working) and `--no-open` (the tab is already open).
 */
export function relaunchArgs(args: string[], port: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--port") {
      i++;
      continue;
    }
    if (arg.startsWith("--port=") || arg === "--no-open") continue;
    out.push(arg);
  }
  return [...out, "--port", String(port), "--no-open"];
}

/**
 * Hand over to another CodeDen version (§16): close this server (the runner keeps running; the
 * new server drains and replaces it, §4.2), then start the new version's CLI as a child in
 * this terminal and stay as a thin parent that passes on its exit code. If the new version
 * exits before answering `/api/health`, the switch is undone and this version starts again,
 * with the failure recorded for the UI. Resolves with the exit code to leave with.
 */
export async function handOver(opts: {
  server: RunningServer;
  home: string;
  args: string[];
  target: { version: string | null };
  fromVersion: string;
  launch: LaunchInfo;
  /** This version's own `dist/cli.js`, to start again if the new one fails. */
  selfEntry: string;
}): Promise<number> {
  const { home, target } = opts;
  const port = opts.server.port;
  const entry = target.version ? cliEntry(home, target.version) : opts.launch.binEntry;
  const expected = target.version ?? opts.launch.binVersion;
  const args = relaunchArgs(opts.args, port);
  let child: ChildProcess | undefined;
  supervise(() => child);
  console.log(`\nCodeDen is restarting as ${expected}...`);
  await opts.server.close();

  const launchedBy = JSON.stringify({
    binEntry: opts.launch.binEntry,
    binVersion: opts.launch.binVersion,
    kind: opts.launch.kind,
  });
  child = start(entry, args, { CODEDEN_LAUNCHED_BY: launchedBy });
  const outcome = await watchStart(child, port, expected);
  if (outcome !== "exited") return exitCode(child);

  const error = `CodeDen ${expected} exited before it started (code ${child.exitCode ?? "?"})`;
  console.error(`${error}; going back to ${opts.fromVersion}.`);
  applyRollback(home, opts.launch.binVersion);
  writeUpdateResult(home, { from: opts.fromVersion, to: expected, ok: false, error });
  child = start(opts.selfEntry, args, { CODEDEN_NO_SWITCH: "1", CODEDEN_LAUNCHED_BY: launchedBy });
  return exitCode(child);
}

function start(entry: string, args: string[], env: Record<string, string>): ChildProcess {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (!env.CODEDEN_NO_SWITCH) delete childEnv.CODEDEN_NO_SWITCH;
  return spawn(process.execPath, [entry, ...args], { stdio: "inherit", env: childEnv });
}

/**
 * Stay out of the way of signals: Ctrl+C reaches the child through the shared terminal (on
 * Windows the console delivers it to both), and `kill` aimed at this parent is passed on.
 */
function supervise(child: () => ChildProcess | undefined): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  if (process.platform === "win32") signals.push("SIGBREAK");
  for (const signal of signals) {
    process.removeAllListeners(signal);
    process.on(signal, () => {
      const c = child();
      if (!c || c.exitCode !== null) return;
      if (process.platform === "win32") {
        // Windows has no graceful kill; the console already sent the event to the child.
        if (signal === "SIGTERM") c.kill();
        return;
      }
      c.kill(signal);
    });
  }
}

/** Wait until the new version answers `/api/health` with `expected`, exits, or we give up. */
async function watchStart(
  child: ChildProcess,
  port: number,
  expected: string,
): Promise<"healthy" | "exited" | "timeout"> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return "exited";
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const health = HealthResponse.safeParse(await res.json());
      if (health.success && health.data.version === expected) return "healthy";
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return "timeout";
}

function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    if (child.signalCode !== null) return resolve(1);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
