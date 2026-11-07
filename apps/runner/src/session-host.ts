import type {
  AgentEvent,
  RunnerCommandOf,
  RunnerEvent,
  RunnerSessionInfo,
} from "@codeden/contracts";
import type { ProviderRegistry, ProviderSession } from "@codeden/providers";

/** Error with a machine-readable code, returned to the server as a failed result. */
export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

interface Hosted {
  providerId: string;
  session: ProviderSession;
  state: RunnerSessionInfo["state"];
  rootThreadId: string | undefined;
}

/**
 * Owns live provider sessions on this runner and pumps their normalized events into the
 * journal (via `emit`). Sessions outlive server connections.
 */
export class SessionHost {
  private readonly sessions = new Map<string, Hosted>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly emit: (event: RunnerEvent) => void,
  ) {}

  list(): RunnerSessionInfo[] {
    return [...this.sessions.entries()].map(([sessionId, h]) => ({
      sessionId,
      providerId: h.providerId,
      state: h.state,
      resumeToken: h.session.resumeToken() ?? null,
    }));
  }

  async start(cmd: RunnerCommandOf<"session.start">): Promise<{ resumeToken: string | null }> {
    if (this.sessions.has(cmd.sessionId)) {
      throw new CommandError("session_exists", `Session ${cmd.sessionId} is already running`);
    }
    const adapter = this.registry.get(cmd.providerId);
    if (!adapter)
      throw new CommandError("unknown_provider", `Provider ${cmd.providerId} is not available`);
    this.emit({ kind: "session.process", sessionId: cmd.sessionId, state: "starting" });
    const session = await adapter.openSession(cmd.options);
    const hosted: Hosted = {
      providerId: cmd.providerId,
      session,
      state: "idle",
      rootThreadId: undefined,
    };
    this.sessions.set(cmd.sessionId, hosted);
    this.emit({ kind: "session.process", sessionId: cmd.sessionId, state: "ready" });
    void this.pump(cmd.sessionId, hosted);
    if (cmd.input) await session.send(cmd.input);
    return { resumeToken: session.resumeToken() ?? null };
  }

  async send(cmd: RunnerCommandOf<"session.send">): Promise<void> {
    await this.get(cmd.sessionId).session.send(cmd.input);
  }

  async steer(cmd: RunnerCommandOf<"session.steer">): Promise<void> {
    const { session } = this.get(cmd.sessionId);
    if (!session.steer) throw new CommandError("unsupported", "This provider cannot steer turns");
    await session.steer(cmd.input);
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.get(sessionId).session.interrupt();
  }

  async respond(cmd: RunnerCommandOf<"session.respond">): Promise<void> {
    await this.get(cmd.sessionId).session.respond(cmd.requestId, cmd.response);
  }

  async stop(sessionId: string): Promise<void> {
    const hosted = this.get(sessionId);
    hosted.state = "closing";
    await hosted.session.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id).catch(() => undefined)));
  }

  private get(sessionId: string): Hosted {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) throw new CommandError("unknown_session", `Session ${sessionId} is not running`);
    return hosted;
  }

  private async pump(sessionId: string, hosted: Hosted): Promise<void> {
    try {
      for await (const event of hosted.session.events) {
        this.track(hosted, event);
        this.emit({ kind: "agent", sessionId, event });
      }
      this.emit({ kind: "session.process", sessionId, state: "exited", exitCode: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        kind: "session.process",
        sessionId,
        state: "crashed",
        error: { code: "provider_crashed", message },
      });
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  private track(hosted: Hosted, event: AgentEvent): void {
    if (event.type === "thread.started" && !event.thread.parentThreadId) {
      hosted.rootThreadId = event.thread.id;
    }
    if (hosted.state === "closing") return;
    const onRoot = "threadId" in event && event.threadId === hosted.rootThreadId;
    if (!onRoot) return;
    if (event.type === "turn.started") hosted.state = "running";
    if (
      event.type === "turn.completed" ||
      event.type === "turn.failed" ||
      event.type === "turn.interrupted"
    ) {
      hosted.state = "idle";
    }
  }
}
