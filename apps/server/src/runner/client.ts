import { randomUUID } from "node:crypto";
import {
  agentEventToNewEvent,
  CODEDEN_VERSION,
  type NewEvent,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCommand,
  type RunnerCommandName,
  type RunnerCommandOf,
  type RunnerCommandResult,
  RunnerCommandResults,
  type RunnerConnectionStatus,
  type RunnerEventMessage,
  type RunnerLock,
  type RunnerStream,
  RunnerToServerMessage,
  type RunnerWelcome,
  type ServerToRunnerMessage,
} from "@codeden/contracts";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import type { Db } from "../db/client";
import { runnerState } from "../db/schema";
import type { EventStore } from "../events/store";
import { type RunnerLaunchConfig, spawnRunner } from "./launcher";
import { readLiveRunnerLock } from "./lock";

export interface RunnerClientOptions {
  home: string;
  lockFile: string;
  db: Db;
  store: EventStore;
  /** How to start a runner when none is live; `null` only attaches to an existing one. */
  launch: RunnerLaunchConfig | null;
  /** Called on every connection status change. */
  onStatus?: (status: RunnerConnectionStatus) => void;
  /** Ephemeral stream data (terminal output, browser frames). */
  onStream?: (stream: RunnerStream) => void;
  log?: (message: string) => void;
  /** Max time to wait for a spawned runner's lock file. Default 20s. */
  startTimeoutMs?: number;
}

interface Pending {
  name: RunnerCommandName;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Error returned by the runner for a failed command. */
export class RunnerCommandError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "RunnerCommandError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Server side of the runner protocol (§4.3): finds or starts the runner, connects,
 * handshakes, persists durable events (acking by seq after commit) and reconnects.
 */
export class RunnerClient {
  private ws: WebSocket | undefined;
  private stopped = false;
  private reconnectDelay = 250;
  private readonly pending = new Map<string, Pending>();
  private connectedWaiters: Array<() => void> = [];
  private runnerId: string | undefined;
  private lastAckedSeq = 0;
  private current: RunnerConnectionStatus = {
    state: "starting",
    runnerId: null,
    version: null,
    providers: [],
    lastError: null,
  };

  constructor(private readonly opts: RunnerClientOptions) {}

  get status(): RunnerConnectionStatus {
    return this.current;
  }

  /** Ensure a runner is live and connect. Resolves once the handshake completed. */
  async start(): Promise<void> {
    this.stopped = false;
    const connected = this.waitForConnection();
    void this.connectLoop();
    await connected;
  }

  /** Resolve when connected (immediately if already). */
  waitForConnection(): Promise<void> {
    if (this.current.state === "connected") return Promise.resolve();
    return new Promise((resolve) => this.connectedWaiters.push(resolve));
  }

  /** Send a command and await its typed result. */
  async request<N extends RunnerCommandName>(
    command: RunnerCommandOf<N>,
    timeoutMs = 30_000,
  ): Promise<RunnerCommandResult<N>> {
    const ws = this.ws;
    if (!ws || this.current.state !== "connected") {
      throw new RunnerCommandError("runner_unavailable", "Runner is not connected");
    }
    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RunnerCommandError("timeout", `Runner command ${command.name} timed out`));
      }, timeoutMs);
      this.pending.set(id, { name: command.name, resolve, reject, timer });
    });
    this.send({ type: "command", id, command: command as RunnerCommand });
    const raw = await result;
    return RunnerCommandResults[command.name as N].parse(raw) as RunnerCommandResult<N>;
  }

  /** Disconnect without stopping the runner (it keeps agents alive across server restarts). */
  async stop(): Promise<void> {
    this.stopped = true;
    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close(1000, "server stopping");
        setTimeout(resolve, 1000).unref();
      });
    }
    this.failPending("Runner client stopped");
  }

  /** Ask the runner process to exit, then disconnect. */
  async shutdownRunner(): Promise<void> {
    if (this.current.state === "connected") {
      await this.request({ name: "runner.shutdown" }, 5_000).catch(() => undefined);
    }
    await this.stop();
  }

  // ---------------------------------------------------------------- connection

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const lock = await this.ensureRunner();
        await this.connect(lock);
        this.reconnectDelay = 250;
        return; // `close` handler restarts the loop.
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus({ ...this.current, state: "disconnected", lastError: message });
        this.opts.log?.(`runner: ${message}; retrying in ${this.reconnectDelay}ms`);
        await sleep(this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5_000);
      }
    }
  }

  private async ensureRunner(): Promise<RunnerLock> {
    const existing = readLiveRunnerLock(this.opts.lockFile);
    if (existing) return existing;
    if (!this.opts.launch) throw new Error("No live runner and launching is disabled");
    this.opts.log?.("runner: starting a new runner process");
    spawnRunner(this.opts.launch, this.opts.home);
    const deadline = Date.now() + (this.opts.startTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      await sleep(100);
      const lock = readLiveRunnerLock(this.opts.lockFile);
      if (lock) return lock;
    }
    throw new Error("Runner did not start in time (see logs/runner.log)");
  }

  private connect(lock: RunnerLock): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${lock.port}/runner`, {
        headers: { authorization: `Bearer ${lock.token}` },
      });
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      ws.on("open", () => {
        this.ws = ws;
        this.send({
          type: "hello",
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          serverVersion: CODEDEN_VERSION,
        });
      });
      ws.on("message", (data) => {
        try {
          this.handle(RunnerToServerMessage.parse(JSON.parse(data.toString())), settle);
        } catch (error) {
          this.opts.log?.(`runner: bad message: ${(error as Error).message}`);
        }
      });
      ws.on("error", (error) => settle(error));
      ws.on("close", () => {
        const wasConnected = this.current.state === "connected";
        if (this.ws === ws) this.ws = undefined;
        settle(new Error("Runner connection closed during handshake"));
        if (wasConnected && this.runnerId) {
          this.opts.store.append([
            {
              type: "runner.disconnected",
              sessionId: null,
              payload: { runnerId: this.runnerId, reason: "connection closed" },
            },
          ]);
        }
        this.failPending("Runner connection closed");
        if (this.current.state !== "incompatible") {
          this.setStatus({ ...this.current, state: "disconnected" });
        }
        if (!this.stopped && wasConnected) void this.connectLoop();
      });
    });
  }

  private handle(msg: RunnerToServerMessage, settle: (error?: Error) => void): void {
    switch (msg.type) {
      case "welcome":
        this.onWelcome(msg);
        settle();
        return;
      case "reject":
        this.setStatus({ ...this.current, state: "incompatible", lastError: msg.message });
        settle(new Error(`Runner rejected the connection: ${msg.message}`));
        return;
      case "result": {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new RunnerCommandError(msg.error.code, msg.error.message));
        return;
      }
      case "event":
        this.onEvent(msg);
        return;
      case "stream":
        this.opts.onStream?.(msg.stream);
        return;
      case "ping":
        this.send({ type: "pong", id: msg.id });
        return;
      case "pong":
        return;
    }
  }

  private onWelcome(msg: RunnerWelcome): void {
    this.runnerId = msg.runnerId;
    const row = this.opts.db
      .select()
      .from(runnerState)
      .where(eq(runnerState.runnerId, msg.runnerId))
      .get();
    this.lastAckedSeq = row?.lastAckedSeq ?? 0;
    const versionNote =
      msg.runnerVersion === CODEDEN_VERSION
        ? null
        : `Runner version ${msg.runnerVersion} differs from server ${CODEDEN_VERSION}`;
    this.opts.store.append([
      {
        type: "runner.connected",
        sessionId: null,
        payload: {
          runnerId: msg.runnerId,
          version: msg.runnerVersion,
          protocolVersion: msg.protocolVersion,
        },
      },
    ]);
    this.setStatus({
      state: "connected",
      runnerId: msg.runnerId,
      version: msg.runnerVersion,
      providers: msg.providers,
      lastError: versionNote,
    });
    // TODO(M1): on version mismatch, drain and restart the runner (§4.2).
    this.send({ type: "resume", lastAckedSeq: this.lastAckedSeq });
    const waiters = this.connectedWaiters;
    this.connectedWaiters = [];
    for (const w of waiters) w();
  }

  /** Persist a durable event and its ack position atomically, then ack. */
  private onEvent(msg: RunnerEventMessage): void {
    const runnerId = this.runnerId;
    if (!runnerId) return;
    if (msg.seq > this.lastAckedSeq) {
      const now = new Date().toISOString();
      this.opts.store.append(toNewEvents(msg), (tx) => {
        tx.insert(runnerState)
          .values({ runnerId, lastAckedSeq: msg.seq, updatedAt: now })
          .onConflictDoUpdate({
            target: runnerState.runnerId,
            set: { lastAckedSeq: msg.seq, updatedAt: now },
          })
          .run();
      });
      this.lastAckedSeq = msg.seq;
    }
    this.send({ type: "ack", seq: msg.seq });
  }

  private send(msg: ServerToRunnerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private failPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RunnerCommandError("runner_unavailable", reason));
      this.pending.delete(id);
    }
  }

  private setStatus(status: RunnerConnectionStatus): void {
    this.current = status;
    this.opts.onStatus?.(status);
  }
}

/** Map a durable runner event to the server events it produces. */
export function toNewEvents(msg: RunnerEventMessage): NewEvent[] {
  const event = msg.event;
  switch (event.kind) {
    case "agent":
      return [agentEventToNewEvent(event.sessionId, event.event)];
    // TODO(M1): map process/setup/pty lifecycle to session status updates and notices.
    case "session.process":
    case "workspace.setup":
    case "pty.exited":
    case "runner.draining":
      return [];
  }
}
