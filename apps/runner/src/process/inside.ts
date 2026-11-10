/** One row of the system process table, with what each platform can tell about it. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  /** Full path of the executable, when readable. */
  exe: string | null;
  /** The full command line, when readable. */
  commandLine: string | null;
  /** Working directory (POSIX only; Windows doesn't expose it to other processes). */
  cwd: string | null;
  /** When the process started (ms since the epoch), where the platform reports it. */
  startedAt: number | null;
}

/** Path form for comparing: forward slashes, no trailing slash, lowercase on Windows. */
function norm(path: string, windows: boolean): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return windows ? slashed.toLowerCase() : slashed;
}

/**
 * True when `path` is `dir` or inside it. Never true for a sibling whose name merely starts
 * with the folder's name (`.../abcd1234-2` is not inside `.../abcd1234`).
 */
export function pathIsInside(dir: string, path: string, windows: boolean): boolean {
  const d = norm(dir, windows);
  const p = norm(path, windows);
  return d !== "" && (p === d || p.startsWith(`${d}/`));
}

/** Characters that continue a path name: a match preceded by one is part of another path. */
const NAME_CHAR = /[\w.\-~]/;

/**
 * True when a command line names a file or folder inside `dir` (`<dir>/...`): a script, a
 * binary, a config. Naming the folder itself doesn't count (an editor opened on it), nor does
 * a longer path that merely contains it (`D:\copy\C:\wt\...`) or a sibling (`.../abcd1234-2`).
 * On Windows the Git Bash form (`/c/Users/...`) counts too.
 */
export function commandLineNamesInside(
  dir: string,
  commandLine: string,
  windows: boolean,
): boolean {
  const d = norm(dir, windows);
  if (!d) return false;
  const line = windows ? commandLine.replace(/\\/g, "/").toLowerCase() : commandLine;
  const forms = [d];
  const drive = /^([a-z]):\/(.*)$/.exec(d);
  if (windows && drive) forms.push(`/${drive[1]}/${drive[2]}`);
  for (const form of forms) {
    const needle = `${form}/`;
    for (let at = line.indexOf(needle); at !== -1; at = line.indexOf(needle, at + 1)) {
      const before = at === 0 ? "" : (line[at - 1] ?? "");
      if (before && (NAME_CHAR.test(before) || before === "/")) continue;
      const next = line[at + needle.length] ?? "";
      if (next && !/[\s"']/.test(next)) return true;
    }
  }
  return false;
}

/**
 * Whether a process runs from or in `dir`: its executable is inside, its working directory
 * (POSIX) is the folder or inside it, or its command line names something inside it.
 */
export function runsInside(dir: string, row: ProcessRow, windows: boolean): boolean {
  if (row.exe && pathIsInside(dir, row.exe, windows)) return true;
  if (row.cwd && pathIsInside(dir, row.cwd, windows)) return true;
  return row.commandLine !== null && commandLineNamesInside(dir, row.commandLine, windows);
}

/** `pid` and every ancestor of it in the table (stopping at loops and unknown parents). */
export function withAncestors(pid: number, rows: readonly ProcessRow[]): Set<number> {
  const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
  const out = new Set<number>();
  for (let p: number | undefined = pid; p !== undefined && p > 0 && !out.has(p); ) {
    out.add(p);
    p = parent.get(p);
  }
  return out;
}

/** `roots` and all their descendants in the table. */
export function withDescendants(roots: Iterable<number>, rows: readonly ProcessRow[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const r of rows) {
    if (r.pid === r.ppid) continue;
    children.set(r.ppid, [...(children.get(r.ppid) ?? []), r.pid]);
  }
  const out = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (out.has(pid)) continue;
    out.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return out;
}

/**
 * Processes CodeDen's agents (or terminals) started: the runner's descendants, plus whatever
 * descends from a process that lost its parent after the runner started, such as the shell an
 * agent ran a dev server in, left behind when the agent exited. Only rows with start times can
 * be judged orphaned (a parent missing, or younger than its child: a reused pid), so a user's
 * own long-running programs, whose parents went away before the runner started, never count.
 */
export function startedByAgents(
  rows: readonly ProcessRow[],
  runnerPid: number,
  runnerStartedAt: number,
): Set<number> {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const roots = [runnerPid];
  for (const r of rows) {
    if (r.startedAt === null || r.startedAt < runnerStartedAt) continue;
    const parent = byPid.get(r.ppid);
    const orphaned = !parent || (parent.startedAt !== null && parent.startedAt > r.startedAt);
    if (orphaned) roots.push(r.pid);
  }
  const out = withDescendants(roots, rows);
  out.delete(runnerPid);
  return out;
}

export interface SelectOptions {
  /** The folder whose processes are ended. */
  dir: string;
  rows: readonly ProcessRow[];
  windows: boolean;
  /**
   * CodeDen's own processes (the runner, the server). They, and every ancestor of theirs, are
   * never chosen: ending an ancestor's process tree would take them down with it.
   */
  protect: readonly number[];
  /** Only these processes may be chosen (see `startedByAgents`). */
  allowed: ReadonlySet<number>;
  /** Processes never chosen (the user's own terminals and what runs in them). */
  spare?: ReadonlySet<number>;
}

/** The processes inside `dir` that may be ended, by pid. */
export function processesToEnd(opts: SelectOptions): number[] {
  const safe = new Set<number>();
  for (const pid of opts.protect) for (const p of withAncestors(pid, opts.rows)) safe.add(p);
  return opts.rows
    .filter((r) => r.pid > 0 && !safe.has(r.pid))
    .filter((r) => opts.allowed.has(r.pid) && !opts.spare?.has(r.pid))
    .filter((r) => runsInside(opts.dir, r, opts.windows))
    .map((r) => r.pid);
}
