import { randomUUID } from "node:crypto";
import {
  type EventOf,
  type RawEventEnvelope,
  type RunnerStream,
  TERMINAL_CONTROL_PREFIX,
  TerminalClientMessage,
  type TerminalQuery,
  type TerminalServerMessage,
} from "@codeden/contracts";
import type { WSContext, WSEvents } from "hono/ws";
import { errorMessage } from "../services/errors";
import type { RunnerPort } from "../services/runner-port";

export interface TerminalBridgeDeps {
  runner: RunnerPort;
  /** Working directory for a new terminal: the session's worktree, else the CodeDen home. */
  cwdFor: (sessionId: string | undefined) => string;
  log?: (message: string) => void;
}

/**
 * Bridges UI terminal sockets (`/ws/pty`, §12.1) to runner terminals (`pty.*`). Terminals
 * live in the runner, so closing a socket only detaches; `kill` closes the terminal.
 * Output arrives as runner stream data and is fanned out to every attached socket.
 */
export class TerminalBridge {
  private readonly sockets = new Map<string, Set<WSContext>>();

  constructor(private readonly deps: TerminalBridgeDeps) {}

  handlers(query: TerminalQuery): WSEvents {
    let ptyId: string | undefined;
    return {
      onOpen: (_event, ws) => {
        void this.open(ws, query).then((id) => {
          ptyId = id;
        });
      },
      onMessage: (event, ws) => {
        if (!ptyId) return;
        let msg: TerminalClientMessage;
        try {
          msg = TerminalClientMessage.parse(JSON.parse(String(event.data)));
        } catch {
          return control(ws, { type: "error", message: "Invalid terminal message" });
        }
        void this.handle(ptyId, msg).catch((error: unknown) =>
          control(ws, { type: "error", message: errorMessage(error) }),
        );
      },
      onClose: (_event, ws) => {
        if (ptyId) this.sockets.get(ptyId)?.delete(ws);
      },
    };
  }

  /** Runner stream data: terminal output goes to the attached sockets. */
  onStream(stream: RunnerStream): void {
    if (stream.kind !== "pty.output") return;
    for (const ws of this.sockets.get(stream.ptyId) ?? []) ws.send(stream.data);
  }

  /** Committed events: tell sockets when their terminal exits. */
  onEvents(events: RawEventEnvelope[]): void {
    for (const e of events) {
      if (e.type !== "pty.exited") continue;
      const { ptyId, exitCode } = (e as EventOf<"pty.exited">).payload;
      for (const ws of this.sockets.get(ptyId) ?? [])
        control(ws, { type: "exited", ptyId, exitCode });
    }
  }

  private async open(ws: WSContext, query: TerminalQuery): Promise<string | undefined> {
    const { runner } = this.deps;
    try {
      if (query.ptyId) {
        const attached = await runner.request({ name: "pty.attach", ptyId: query.ptyId });
        this.attach(query.ptyId, ws);
        control(ws, { type: "opened", ptyId: query.ptyId, pid: attached.pid, attached: true });
        if (attached.scrollback) ws.send(attached.scrollback);
        if (attached.exited) {
          control(ws, { type: "exited", ptyId: query.ptyId, exitCode: attached.exitCode });
        }
        return query.ptyId;
      }
      const ptyId = `pty-${randomUUID()}`;
      this.attach(ptyId, ws);
      const opened = await runner.request({
        name: "pty.open",
        ptyId,
        cwd: this.deps.cwdFor(query.sessionId),
        cols: query.cols,
        rows: query.rows,
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      });
      control(ws, { type: "opened", ptyId, pid: opened.pid, attached: false });
      if (query.command)
        await runner.request({ name: "pty.input", ptyId, data: `${query.command}\r` });
      return ptyId;
    } catch (error) {
      control(ws, { type: "error", message: errorMessage(error) });
      ws.close(1011, "terminal unavailable");
      return undefined;
    }
  }

  private async handle(ptyId: string, msg: TerminalClientMessage): Promise<void> {
    const { runner } = this.deps;
    switch (msg.type) {
      case "input":
        await runner.request({ name: "pty.input", ptyId, data: msg.data });
        return;
      case "resize":
        await runner.request({ name: "pty.resize", ptyId, cols: msg.cols, rows: msg.rows });
        return;
      case "kill": {
        await runner.request({ name: "pty.close", ptyId });
        // A terminal closed on request reports no exit event of its own.
        for (const ws of this.sockets.get(ptyId) ?? []) {
          control(ws, { type: "exited", ptyId, exitCode: null });
        }
        this.sockets.delete(ptyId);
        return;
      }
    }
  }

  private attach(ptyId: string, ws: WSContext): void {
    const set = this.sockets.get(ptyId) ?? new Set();
    set.add(ws);
    this.sockets.set(ptyId, set);
  }
}

function control(ws: WSContext, msg: TerminalServerMessage): void {
  ws.send(`${TERMINAL_CONTROL_PREFIX}${JSON.stringify(msg)}`);
}
