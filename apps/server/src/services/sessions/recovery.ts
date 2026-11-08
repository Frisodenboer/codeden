import type { Session } from "@codeden/contracts";
import { errorMessage } from "../errors";
import type { RunnerPort } from "../runner-port";
import type { SessionLauncher } from "./launcher";
import type { SessionRepo } from "./repo";
import type { SessionService } from "./session-service";

/** The message sent to an agent whose turn was cut off by a restart (§4.2). */
export const RESTART_CONTINUE_MESSAGE =
  "You were interrupted by a CodeDen restart; continue where you left off.";

export interface RecoveryDeps {
  repo: SessionRepo;
  sessions: SessionService;
  launcher: SessionLauncher;
  runner: RunnerPort;
  log?: (message: string) => void;
}

const CUT_OFF = ["running", "waiting", "interrupted"] as const;

/**
 * After a runner (re)connects: resume sessions whose turn was cut off by a runner drain,
 * restart or crash, with an automatic "continue" message, and deliver messages that were
 * queued before a server restart. Idle sessions are resumed lazily on their next message.
 */
export class SessionRecovery {
  private running: Promise<void> | undefined;

  constructor(private readonly deps: RecoveryDeps) {}

  /** Called when a current runner is connected and configured. Never throws. */
  onRunnerReady(): Promise<void> {
    this.running ??= this.recover().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async recover(): Promise<void> {
    const { repo, runner, sessions, log } = this.deps;
    // Only sessions that were cut off before this runner was ready. A session started on it
    // meanwhile can turn `running` while `runner.status` is in flight (its first events can
    // arrive in the same read as the reply) and must not be mistaken for a cut-off one.
    const candidates = repo
      .list({ status: [...CUT_OFF] })
      .filter((s) => !sessions.launching.has(s.id))
      .map((s) => s.id);
    let hosted: Set<string>;
    try {
      const status = await runner.request({ name: "runner.status" }, 10_000);
      hosted = new Set(status.sessions.map((s) => s.sessionId));
    } catch (error) {
      log?.(`recovery: runner status failed: ${errorMessage(error)}`);
      return;
    }
    for (const id of candidates) {
      const session = repo.find(id)?.session;
      if (!session || hosted.has(id) || sessions.launching.has(id)) continue;
      if (!(CUT_OFF as readonly string[]).includes(session.status)) continue;
      await this.resume(session);
    }

    for (const id of sessions.sessionsWithQueuedMessages()) {
      const session = repo.find(id)?.session;
      if (session?.status === "idle") await sessions.flushOutbox(id).catch(() => undefined);
    }
  }

  private async resume(session: Session): Promise<void> {
    const provider = this.deps.runner.providers().find((p) => p.id === session.provider);
    if (!session.resumeToken || !provider?.capabilities.resume) {
      this.deps.launcher.fail(
        session.id,
        "restart",
        new Error("The session was cut off by a restart and cannot be resumed"),
      );
      return;
    }
    try {
      this.deps.log?.(`recovery: resuming session ${session.id}`);
      await this.deps.sessions.continueAfterRestart(session.id, RESTART_CONTINUE_MESSAGE);
    } catch (error) {
      this.deps.launcher.fail(session.id, "restart", error);
    }
  }
}
