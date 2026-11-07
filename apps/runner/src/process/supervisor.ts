import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { isInside } from "../util/paths";
import { childEnv } from "./env";
import { isAlive, killTree, listDescendants } from "./tree";

/** A process the runner started (or adopted, like a pty shell). */
export interface TrackedProcess {
  pid: number;
  label: string;
  cwd: string;
}

export interface RunShellOptions {
  cwd: string;
  env?: Record<string, string>;
  /** Kill the process tree after this long. Default 30 minutes. */
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  label?: string;
}

export interface RunShellResult {
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Tracks every child process the runner starts so they can be killed as whole process
 * trees: on stop, when their worktree is removed, and on runner shutdown. On POSIX,
 * children are spawned as process-group leaders so a group signal reaches grandchildren.
 */
export class ProcessSupervisor {
  private readonly tracked = new Map<number, TrackedProcess>();

  list(): TrackedProcess[] {
    return [...this.tracked.values()];
  }

  /** Track a process started elsewhere (pty shells). */
  adopt(proc: TrackedProcess): void {
    this.tracked.set(proc.pid, proc);
  }

  release(pid: number): void {
    this.tracked.delete(pid);
  }

  /** Spawn a tracked child. It is untracked automatically when it exits. */
  spawn(
    command: string,
    args: string[],
    opts: SpawnOptions & { cwd: string; label?: string },
  ): ChildProcess {
    const child = spawn(command, args, {
      ...opts,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const pid = child.pid;
    if (pid !== undefined) {
      this.tracked.set(pid, { pid, label: opts.label ?? command, cwd: opts.cwd });
      child.once("exit", () => this.tracked.delete(pid));
    }
    return child;
  }

  /** Run a shell command line, streaming combined output. Never rejects for exit codes. */
  runShell(command: string, opts: RunShellOptions): Promise<RunShellResult> {
    return new Promise((resolveResult) => {
      const child = this.spawn(command, [], {
        cwd: opts.cwd,
        shell: true,
        env: { ...childEnv(), ...opts.env },
        stdio: ["ignore", "pipe", "pipe"],
        label: opts.label ?? command,
      });
      let timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          if (child.pid !== undefined) void killTree(child.pid);
        },
        opts.timeoutMs ?? 30 * 60_000,
      );
      const onData = (data: Buffer) => opts.onOutput?.(data.toString("utf8"));
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("error", (error) => {
        clearTimeout(timer);
        opts.onOutput?.(`${error.message}\n`);
        resolveResult({ exitCode: null, timedOut });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolveResult({ exitCode: code, timedOut });
      });
    });
  }

  /** Kill the trees of tracked processes whose cwd is inside `dir` (before removing it). */
  async killUnder(dir: string): Promise<void> {
    const victims = this.list().filter((p) => isInside(dir, p.cwd));
    await Promise.all(victims.map((p) => this.kill(p.pid)));
  }

  async kill(pid: number): Promise<void> {
    await killTree(pid);
    if (!isAlive(pid)) this.tracked.delete(pid);
  }

  /**
   * Kill every tracked tree. With `sweepDescendants`, also kill any remaining descendant of
   * this process (provider processes started by adapters), so a clean shutdown of the
   * runner process leaves nothing behind. Not used when the runner is embedded (tests).
   */
  async killAll(sweepDescendants = false): Promise<void> {
    await Promise.all(this.list().map((p) => this.kill(p.pid)));
    if (!sweepDescendants) return;
    const rest = await listDescendants(process.pid).catch(() => [] as number[]);
    await Promise.all(rest.map((pid) => killTree(pid, 500)));
  }
}
