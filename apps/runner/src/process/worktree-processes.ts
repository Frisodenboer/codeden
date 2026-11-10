import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProcessRow, processesToEnd, startedByAgents, withDescendants } from "./inside";
import { processTable } from "./table";
import { killTree } from "./tree";

export interface EndProcessesOptions {
  /** The CodeDen home: its `server.json` names the server process, which is never ended. */
  home: string;
  /** Also allowed: processes seen as the runner's descendants earlier (`runnerDescendants`). */
  seen?: ReadonlySet<number>;
  /** Processes never ended, with everything they started (the user's terminals). */
  spare?: readonly number[];
  log?: (message: string) => void;
  /** Reads the process table (tests). */
  table?: () => Promise<ProcessRow[]>;
  /** Ends a process tree (tests). */
  kill?: (pid: number) => Promise<void>;
}

/** When this runner process started (ms since the epoch). */
const RUNNER_STARTED_AT = Date.now() - process.uptime() * 1000;

/** The server's pid from `<home>/server.json`, when it is there. */
function serverPid(home: string): number | undefined {
  try {
    const lock = JSON.parse(readFileSync(join(home, "server.json"), "utf8")) as { pid?: unknown };
    return typeof lock.pid === "number" ? lock.pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The runner's descendants right now, by pid. Taken before a session stops, so what its agent
 * started still counts as the agent's once the agent has exited (where a process that lost its
 * parent is adopted by another, as on Linux and macOS).
 */
export async function runnerDescendants(
  table: () => Promise<ProcessRow[]> = processTable,
): Promise<Set<number>> {
  const rows = await table().catch(() => [] as ProcessRow[]);
  const all = withDescendants([process.pid], rows);
  all.delete(process.pid);
  return all;
}

/**
 * End the processes still running from or in `dir` that the runner doesn't track itself: a dev
 * server an agent started through its shell outlives the agent, and on Windows a process
 * holding a file (or its working directory) in a folder keeps the folder from being moved.
 *
 * A process counts when its executable or its working directory (POSIX) is inside `dir`, or
 * its command line names something inside it, matched as whole paths; and it was started by
 * CodeDen's agents or terminals (`startedByAgents`), so a user's own editor or shell is never
 * ended. CodeDen itself is never ended either: not the runner, not the server, and not their
 * ancestors (the CLI, the desktop app). Returns the pids it ended; never throws.
 */
export async function endProcessesInside(
  dir: string,
  opts: EndProcessesOptions,
): Promise<number[]> {
  let rows: ProcessRow[];
  try {
    rows = await (opts.table ?? processTable)();
  } catch (error) {
    opts.log?.(`could not list processes in ${dir}: ${(error as Error).message}`);
    return [];
  }
  const server = serverPid(opts.home);
  const allowed = startedByAgents(rows, process.pid, RUNNER_STARTED_AT);
  for (const pid of opts.seen ?? []) allowed.add(pid);
  const victims = processesToEnd({
    dir,
    rows,
    windows: process.platform === "win32",
    protect: [process.pid, ...(server !== undefined ? [server] : [])],
    allowed,
    spare: opts.spare ? withDescendants(opts.spare, rows) : undefined,
  });
  if (victims.length === 0) return [];
  const kill = opts.kill ?? ((pid: number) => killTree(pid, 500));
  await Promise.all(victims.map((pid) => kill(pid).catch(() => undefined)));
  const names = victims.map((pid) => {
    const row = rows.find((r) => r.pid === pid);
    return `${pid} (${row?.exe ?? row?.commandLine?.slice(0, 80) ?? "?"})`;
  });
  opts.log?.(`ended ${victims.length} process(es) in ${dir}: ${names.join(", ")}`);
  return victims;
}
