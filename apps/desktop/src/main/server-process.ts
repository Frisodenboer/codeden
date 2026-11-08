import { type ChildProcess, fork } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import {
  type DesktopHostMessage,
  DesktopServerMessage,
  type DesktopUpdateCommand,
} from "@codeden/contracts";

export interface ServerReady {
  url: string;
  port: number;
  launchUrl: string;
  version: string;
}

export class ServerStartError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export interface ServerProcessOptions {
  /** `dist/server.js`. */
  entry: string;
  home: string;
  port: number;
  fake: boolean;
  /** Server output goes here (`<home>/logs/desktop-server.log`). */
  logFile: string;
  /** The server asks the updater to do something; answer with `send({ type: "update.done" })`. */
  onUpdateCommand: (id: string, command: DesktopUpdateCommand) => void;
  /** The process exited without being asked to (crash, or `codeden stop` from a terminal). */
  onUnexpectedExit: (code: number | null) => void;
  log: (message: string) => void;
}

/**
 * The server the app starts (§17): `dist/server.js` forked on the app's own binary as Node.js
 * (Electron's `fork` sets `ELECTRON_RUN_AS_NODE` and, on macOS, uses the helper binary so no
 * second dock icon appears). It is a normal child: when the app goes away it closes, while
 * the detached runner it started keeps the agents running.
 */
export class ServerProcess {
  private child: ChildProcess | undefined;
  private stopping = false;

  constructor(private readonly opts: ServerProcessOptions) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): Promise<ServerReady> {
    mkdirSync(dirname(this.opts.logFile), { recursive: true });
    const out = openSync(this.opts.logFile, "a");
    const args = ["--home", this.opts.home, "--port", String(this.opts.port)];
    if (this.opts.fake) args.push("--fake");
    const child = fork(this.opts.entry, args, {
      stdio: ["ignore", out, out, "ipc"],
      env: { ...process.env, CODEDEN_DEPS_INSTALLER: "registry" },
      windowsHide: true,
    });
    this.child = child;
    this.opts.log(`server: started pid ${child.pid} (port ${this.opts.port})`);

    return new Promise<ServerReady>((resolve, reject) => {
      let settled = false;
      child.on("message", (raw) => {
        const parsed = DesktopServerMessage.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "ready" && !settled) {
          settled = true;
          resolve(message);
        } else if (message.type === "failed" && !settled) {
          settled = true;
          reject(new ServerStartError(message.message, message.code));
        } else if (message.type === "update.command") {
          this.opts.onUpdateCommand(message.id, message.command);
        }
      });
      child.once("exit", (code) => {
        this.opts.log(`server: exited (code ${code})`);
        this.child = undefined;
        if (!settled) {
          settled = true;
          reject(new ServerStartError(`The server exited (code ${code}) before it started`, null));
          return;
        }
        if (!this.stopping) this.opts.onUnexpectedExit(code);
      });
    });
  }

  send(message: DesktopHostMessage): void {
    if (this.child?.connected) this.child.send(message);
  }

  /**
   * Close the server; with `stopRunner` the runner drains and exits too (as `codeden stop`),
   * so an update can replace the files it runs from. Kills the process if it hangs.
   */
  async stop(opts: { stopRunner: boolean; timeoutMs?: number }): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    this.send({ type: "shutdown", stopRunner: opts.stopRunner });
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), opts.timeoutMs ?? 20_000).unref(),
    );
    if ((await Promise.race([exited, timeout])) === "timeout") {
      this.opts.log("server: did not exit in time; killing it");
      child.kill();
      await exited;
    }
  }
}
