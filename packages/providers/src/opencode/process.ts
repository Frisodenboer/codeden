import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { killTree, type ResolvedCommand, spawnResolved } from "../util/exec";
import { OpencodeClient } from "./client";

/** How long `opencode serve` may take to print its address and answer a health check. */
export const OPENCODE_START_TIMEOUT_MS = 30_000;

const LISTENING = /listening on (https?:\/\/[^\s]+)/i;

export interface OpencodeServerOptions {
  /** Skip the user's external opencode plugins (`--pure`). */
  pure?: boolean;
  startTimeoutMs?: number;
  /** Extra environment for the server process. */
  env?: Record<string, string>;
}

/** The address `opencode serve` printed, e.g. `http://127.0.0.1:4096`, or undefined. */
export function parseListeningUrl(output: string): string | undefined {
  return LISTENING.exec(output)?.[1]?.replace(/\/+$/, "");
}

/**
 * One `opencode serve` process, shared by every opencode session of a runner (one server per
 * runner, docs/plans/opencode-provider.md). Started on first use with a random Basic-auth
 * password so other local processes cannot drive it; started again on the next `client()`
 * after it exits. Sessions hear about exits through `onExit`.
 */
export class OpencodeServer {
  private child: ChildProcess | undefined;
  private current: OpencodeClient | undefined;
  private starting: Promise<OpencodeClient> | undefined;
  private stopped = false;
  private readonly exitListeners = new Set<(code: number | null, stderr: string) => void>();

  constructor(
    private readonly executable: () => ResolvedCommand | undefined,
    private readonly options: OpencodeServerOptions = {},
  ) {}

  /** A client for the running server, starting it when needed. */
  client(): Promise<OpencodeClient> {
    if (this.current) return Promise.resolve(this.current);
    this.stopped = false;
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  get running(): boolean {
    return this.current !== undefined;
  }

  /** Call `listener` when the server process exits unexpectedly. Returns unsubscribe. */
  onExit(listener: (code: number | null, stderr: string) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /**
   * Stop the server (and its child processes) and wait until it has exited, so a runner that
   * quits right after does not leave it behind. Gives up waiting after a few seconds.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    this.child = undefined;
    this.current = undefined;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(resolve, 5000).unref?.();
    });
    killTree(child);
    await exited;
    // `taskkill /T` itself needs a moment after the launcher exits to end the server binary.
    if (process.platform === "win32") await new Promise((r) => setTimeout(r, 500));
  }

  private async start(): Promise<OpencodeClient> {
    const exe = this.executable();
    if (!exe) throw new Error("opencode is not installed (no `opencode` on PATH)");
    const password = randomBytes(24).toString("base64url");
    const args = ["serve", "--hostname", "127.0.0.1", "--port", "0"];
    if (this.options.pure) args.push("--pure");
    const child = spawnResolved(exe, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: tmpdir(),
      env: { ...process.env, ...this.options.env, OPENCODE_SERVER_PASSWORD: password },
    });
    this.child = child;
    let stdout = "";
    let stderr = "";
    const timeoutMs = this.options.startTimeoutMs ?? OPENCODE_START_TIMEOUT_MS;

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        killTree(child);
        reject(new Error(`opencode serve did not start within ${timeoutMs}ms`));
      }, timeoutMs);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.stdout?.setEncoding("utf8").on("data", (d: string) => {
        stdout = (stdout + d).slice(-8000);
        const found = parseListeningUrl(stdout);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      });
      child.stderr?.setEncoding("utf8").on("data", (d: string) => {
        stderr = (stderr + d).slice(-8000);
      });
      child.on("error", fail);
      child.on("exit", (code) => {
        fail(
          new Error(
            `opencode serve exited (code ${code ?? "unknown"}) before listening${
              stderr ? `: ${stderr.slice(-500)}` : ""
            }`,
          ),
        );
      });
    });

    const client = new OpencodeClient({ url, password });
    try {
      const health = await client.health(AbortSignal.timeout(timeoutMs));
      if (!health.healthy) throw new Error("opencode serve reports it is not healthy");
    } catch (error) {
      killTree(child);
      throw error;
    }
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.current = undefined;
      if (this.stopped) return;
      for (const listener of this.exitListeners) {
        try {
          listener(code, stderr);
        } catch {
          // One failing listener must not stop the others.
        }
      }
    });
    if (this.stopped) {
      killTree(child);
      throw new Error("opencode server was stopped while starting");
    }
    this.current = client;
    return client;
  }
}
