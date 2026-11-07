import {
  type DiscoveryArea,
  type FactoryItem,
  type Session,
  type StartedBy,
  StartSessionRequest,
  type StartSessionRequestInit,
  type StartSessionResponse,
} from "@codeden/contracts";
import { errorMessage } from "../errors";
import type { RunnerPort } from "../runner-port";
import type { SessionRepo } from "../sessions/repo";
import type { SessionService } from "../sessions/session-service";
import { builderPrompt, discoveryPrompt, revertPrompt, reviewerPrompt } from "./prompts";

/** Who starts factory sessions; `id: "factory"` marks them for limits and the kill switch. */
export const FACTORY_STARTER: StartedBy = { kind: "pm", id: "factory" };

/** Statuses that hold a session slot (`maxConcurrentSessions`). */
const SLOT_STATUSES = new Set(["created", "queued", "starting", "running", "waiting"]);
/** Statuses of sessions the kill switch stops. */
const LIVE_STATUSES = new Set([...SLOT_STATUSES, "idle", "interrupted"]);

export function isFactorySession(s: Session): boolean {
  return s.startedBy.kind === FACTORY_STARTER.kind && s.startedBy.id === FACTORY_STARTER.id;
}

export interface FactorySessionsDeps {
  sessions: SessionService;
  repo: SessionRepo;
  runner: RunnerPort;
  log?: (message: string) => void;
}

/** Starts and stops the factory's agent sessions through the normal session service (§8.2). */
export class FactorySessions {
  constructor(private readonly deps: FactorySessionsDeps) {}

  /** Factory sessions of a project, newest first. */
  list(projectId: string): Session[] {
    return this.deps.repo.list({ projectId, role: "agent" }).filter(isFactorySession);
  }

  /** Factory sessions holding a slot right now. */
  activeCount(projectId: string): number {
    return this.list(projectId).filter((s) => SLOT_STATUSES.has(s.status)).length;
  }

  /** Providers the runner offers (the Fake provider only when nothing else is there). */
  providers(): string[] {
    const ids = this.deps.runner.providers().map((p) => p.id);
    const real = ids.filter((id) => id !== "fake");
    return real.length > 0 ? real : ids;
  }

  startDiscovery(
    projectId: string,
    area: DiscoveryArea,
    vision: string,
    known: string[],
  ): Promise<StartSessionResponse> {
    return this.start({
      projectId,
      purpose: `Factory: find ${area.replace("_", " ")} improvements`,
      workKey: `factory:discover:${area}`,
      scope: { area: `factory-discover-${area}` },
      title: `Factory discovery: ${area}`,
      input: { text: discoveryPrompt({ area, vision, known }), attachments: [] },
    });
  }

  startBuilder(item: FactoryItem, vision: string, provider: string): Promise<StartSessionResponse> {
    return this.start({
      projectId: item.projectId,
      provider,
      purpose: `Factory: ${item.title}`.slice(0, 300),
      workKey: item.workKey,
      title: item.title.slice(0, 200),
      issue: item.issue ?? undefined,
      input: { text: builderPrompt(item, vision), attachments: [] },
    });
  }

  startReviewer(
    item: FactoryItem,
    vision: string,
    provider: string,
    note: string | null,
  ): Promise<StartSessionResponse> {
    const builder = item.builderSessionId
      ? this.deps.repo.find(item.builderSessionId)?.session
      : undefined;
    const worktree = builder?.worktreePath ?? null;
    return this.start({
      projectId: item.projectId,
      provider,
      purpose: `Factory review: ${item.title}`.slice(0, 300),
      workKey: `factory:review:${item.pr?.number ?? item.id}`,
      title: `Review: ${item.title}`.slice(0, 200),
      issue: item.issue ?? undefined,
      workspace: worktree ? { mode: "existing", path: worktree } : { mode: "worktree" },
      input: { text: reviewerPrompt(item, vision, note), attachments: [] },
    });
  }

  startRevert(
    projectId: string,
    merge: { sha: string; prNumber: number; title: string },
  ): Promise<StartSessionResponse> {
    return this.start({
      projectId,
      purpose: `Factory: revert #${merge.prNumber} after a CI regression`,
      workKey: `factory:revert:${merge.sha.slice(0, 7)}`,
      title: `Revert #${merge.prNumber}`,
      input: { text: revertPrompt(merge), attachments: [] },
    });
  }

  /** Send a follow-up to a session (queued behind a running turn). */
  async message(sessionId: string, text: string): Promise<void> {
    await this.deps.sessions.send(sessionId, {
      input: { text, attachments: [] },
      whenBusy: "queue",
    });
  }

  /** Stop every live factory session of a project (kill switch). Returns the stopped ids. */
  async stopAll(projectId: string): Promise<string[]> {
    const stopped: string[] = [];
    for (const s of this.list(projectId)) {
      if (!LIVE_STATUSES.has(s.status)) continue;
      try {
        await this.deps.sessions.stop(s.id);
        stopped.push(s.id);
      } catch (error) {
        this.deps.log?.(`factory: stop ${s.id}: ${errorMessage(error)}`);
      }
    }
    return stopped;
  }

  private start(req: StartSessionRequestInit): Promise<StartSessionResponse> {
    return this.deps.sessions.start(
      StartSessionRequest.parse({ role: "agent", startedBy: FACTORY_STARTER, ...req }),
    );
  }
}
