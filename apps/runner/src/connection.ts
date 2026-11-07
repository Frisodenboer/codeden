import {
  CODEDEN_VERSION,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCommand,
  type RunnerCommandResult,
  type RunnerToServerMessage,
  type ServerToRunnerMessage,
  ServerToRunnerMessage as ServerToRunnerSchema,
} from "@codeden/contracts";
import type { ProviderRegistry } from "@codeden/providers";
import type { WSContext, WSEvents } from "hono/ws";
import type { Journal } from "./journal";
import { CommandError, type SessionHost } from "./session-host";

export interface RunnerCore {
  journal: Journal;
  host: SessionHost;
  registry: ProviderRegistry;
  startedAt: string;
  isDraining: () => boolean;
  drain: (reason: string) => void;
  /** Exit the process shortly after the current result is sent. */
  shutdown: () => void;
}

/**
 * One server connection. Handshake (`hello` -> `welcome` -> `resume`), then commands, acks
 * and journaled events. Only one connection is "attached" (receives events) at a time.
 */
export class ServerConnection {
  private attached = false;

  constructor(
    private readonly ws: WSContext,
    private readonly core: RunnerCore,
    private readonly onAttach: (conn: ServerConnection) => void,
  ) {}

  get isAttached(): boolean {
    return this.attached;
  }

  /** Deliver a freshly journaled event if attached (otherwise it waits in the journal). */
  deliver(msg: RunnerToServerMessage): void {
    if (this.attached) this.send(msg);
  }

  detach(): void {
    this.attached = false;
  }

  close(reason: string): void {
    this.attached = false;
    this.ws.close(1000, reason);
  }

  async handle(raw: unknown): Promise<void> {
    const parsed = ServerToRunnerSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg: ServerToRunnerMessage = parsed.data;
    switch (msg.type) {
      case "hello":
        if (msg.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
          this.send({
            type: "reject",
            reason: "protocol_mismatch",
            message: `Runner speaks protocol ${RUNNER_PROTOCOL_VERSION}, server sent ${msg.protocolVersion}`,
            supportedProtocolVersions: [RUNNER_PROTOCOL_VERSION],
          });
          return;
        }
        this.send({
          type: "welcome",
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          runnerId: this.core.journal.runnerId,
          runnerVersion: CODEDEN_VERSION,
          pid: process.pid,
          startedAt: this.core.startedAt,
          capabilities: { pty: false, browser: false, git: false, mcpProxy: false },
          providers: this.core.registry.info(),
          sessions: this.core.host.list(),
          journal: { lastSeq: this.core.journal.lastSeq, unacked: this.core.journal.unacked },
          draining: this.core.isDraining(),
        });
        return;
      case "resume":
        // Synchronous replay + attach: nothing can be journaled in between.
        this.core.journal.ack(msg.lastAckedSeq);
        for (const event of this.core.journal.after(msg.lastAckedSeq)) this.send(event);
        this.attached = true;
        this.onAttach(this);
        return;
      case "ack":
        this.core.journal.ack(msg.seq);
        return;
      case "command":
        try {
          const result = await this.execute(msg.command);
          this.send({ type: "result", id: msg.id, ok: true, result });
        } catch (error) {
          const code = error instanceof CommandError ? error.code : "command_failed";
          const message = error instanceof Error ? error.message : String(error);
          this.send({ type: "result", id: msg.id, ok: false, error: { code, message } });
        }
        return;
      case "ping":
        this.send({ type: "pong", id: msg.id });
        return;
      case "pong":
        return;
    }
  }

  private async execute(
    command: RunnerCommand,
  ): Promise<RunnerCommandResult<RunnerCommand["name"]>> {
    const { host, journal, registry } = this.core;
    switch (command.name) {
      case "runner.status":
        return {
          sessions: host.list(),
          ptys: [],
          journal: { lastSeq: journal.lastSeq, unacked: journal.unacked },
          draining: this.core.isDraining(),
        };
      case "runner.drain":
        this.core.drain(command.reason);
        return {};
      case "runner.shutdown":
        this.core.shutdown();
        return {};
      case "provider.detect": {
        const adapters = command.providerId
          ? registry.list().filter((a) => a.id === command.providerId)
          : registry.list();
        return { statuses: await Promise.all(adapters.map((a) => a.detect())) };
      }
      case "session.start":
        if (this.core.isDraining()) throw new CommandError("draining", "Runner is draining");
        return host.start(command);
      case "session.send":
        await host.send(command);
        return {};
      case "session.steer":
        await host.steer(command);
        return {};
      case "session.interrupt":
        await host.interrupt(command.sessionId);
        return {};
      case "session.respond":
        await host.respond(command);
        return {};
      case "session.stop":
        await host.stop(command.sessionId);
        return {};
      // TODO(M1): worktrees, node-pty terminals, Chromium/CDP browser and git checkpoints.
      case "workspace.prepare":
      case "pty.open":
      case "pty.input":
      case "pty.resize":
      case "pty.close":
      case "browser.open":
      case "browser.navigate":
      case "browser.close":
      case "git.checkpoint":
      case "git.status":
      case "git.diff":
      case "runner.configure":
      case "workspace.remove":
      case "pty.attach":
      case "git.branches":
      case "git.commit":
      case "git.push":
      case "checkpoint.list":
      case "checkpoint.diff":
      case "checkpoint.restoreFiles":
      case "ports.list":
        throw new CommandError("not_implemented", `${command.name} is not implemented yet`);
    }
  }

  private send(msg: RunnerToServerMessage): void {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}

/** Build `upgradeWebSocket` handlers bound to a connection. */
export function connectionHandlers(
  core: RunnerCore,
  register: (conn: ServerConnection) => void,
  unregister: (conn: ServerConnection) => void,
  onAttach: (conn: ServerConnection) => void,
): WSEvents {
  let conn: ServerConnection | undefined;
  return {
    onOpen: (_event, ws) => {
      conn = new ServerConnection(ws, core, onAttach);
      register(conn);
    },
    onMessage: (event) => {
      if (!conn || typeof event.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      void conn.handle(raw);
    },
    onClose: () => {
      if (conn) unregister(conn);
    },
  };
}
