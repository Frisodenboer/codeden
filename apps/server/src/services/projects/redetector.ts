import type { RawEventEnvelope, RefreshProjectResponse } from "@codeden/contracts";
import type { EventStore } from "../../events/store";
import { errorMessage } from "../errors";
import type { SessionRepo } from "../sessions/repo";
import type { ProjectService } from "./project-service";

export interface ProjectRedetectorDeps {
  projects: ProjectService;
  store: EventStore;
  repo: SessionRepo;
  /** A project became a GitHub project or moved to another repository: sync it now. */
  onGithubChanged?: (projectId: string) => void;
  log?: (message: string) => void;
}

const TURN_ENDS = new Set(["agent.turn.completed", "agent.turn.failed", "agent.turn.interrupted"]);

/**
 * Keeps each project's kind in step with its folder (§9). A project's git checkout and GitHub
 * remote are detected again on demand (the UI's "Check again"), once for every project when
 * the server starts, and whenever an agent turn ends in a local-only project: the moment an
 * agent may have run `git init` or added a GitHub `origin`. One check per project at a time;
 * a turn that ends during a check queues one more.
 */
export class ProjectRedetector {
  private unsubscribe: (() => void) | undefined;
  private stopped = true;
  private readonly running = new Map<string, Promise<RefreshProjectResponse>>();
  private readonly again = new Set<string>();

  constructor(private readonly deps: ProjectRedetectorDeps) {}

  /** Follow turn ends and, unless `checkAll: false`, check every project in the background. */
  start(opts: { checkAll?: boolean } = {}): void {
    this.stopped = false;
    this.unsubscribe ??= this.deps.store.subscribe((events) => this.onEvents(events));
    if (opts.checkAll !== false) setImmediate(() => void this.checkAll());
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Detect one project again now (joins a check already running for it). */
  refresh(projectId: string): Promise<RefreshProjectResponse> {
    const inFlight = this.running.get(projectId);
    if (inFlight) return inFlight;
    const run = this.deps.projects
      .refresh(projectId)
      .then((result) => {
        const github = result.outcome === "github_connected" || result.outcome === "github_changed";
        if (result.changed) {
          this.deps.log?.(`projects: ${result.project.name}: ${result.message}`);
          if (github) this.deps.onGithubChanged?.(projectId);
        }
        return result;
      })
      .finally(() => {
        this.running.delete(projectId);
        if (this.again.delete(projectId)) this.afterTurn(projectId);
      });
    this.running.set(projectId, run);
    return run;
  }

  /** Check every non-archived project, one at a time (on server start). Never throws. */
  async checkAll(): Promise<void> {
    if (this.stopped) return; // closed before the check began (the database may be closed)
    let projects: ReturnType<ProjectService["list"]>;
    try {
      projects = this.deps.projects.list();
    } catch (error) {
      this.deps.log?.(`projects: listing for the start-up check: ${errorMessage(error)}`);
      return;
    }
    for (const project of projects) {
      if (this.stopped) return;
      await this.refresh(project.id).catch((error: unknown) =>
        this.deps.log?.(`projects: checking ${project.name}: ${errorMessage(error)}`),
      );
    }
  }

  private onEvents(events: RawEventEnvelope[]): void {
    const sessionIds = new Set<string>();
    for (const e of events) if (TURN_ENDS.has(e.type) && e.sessionId) sessionIds.add(e.sessionId);
    if (sessionIds.size === 0) return;
    // After commit, never inside the store's notification.
    setImmediate(() => {
      if (this.stopped) return;
      const projectIds = new Set<string>();
      try {
        for (const id of sessionIds) {
          const projectId = this.deps.repo.find(id)?.session.projectId;
          if (projectId) projectIds.add(projectId);
        }
      } catch (error) {
        this.deps.log?.(`projects: after a turn: ${errorMessage(error)}`);
        return;
      }
      for (const projectId of projectIds) this.afterTurn(projectId);
    });
  }

  /** A turn ended in this project: check it if it is still local-only. */
  private afterTurn(projectId: string): void {
    if (this.stopped) return;
    try {
      const project = this.deps.projects.get(projectId);
      if (project.kind !== "local" || project.archivedAt !== null) return;
    } catch {
      return; // the project is gone, or the database is closing
    }
    if (this.running.has(projectId)) {
      this.again.add(projectId);
      return;
    }
    this.refresh(projectId).catch((error: unknown) =>
      this.deps.log?.(`projects: checking ${projectId}: ${errorMessage(error)}`),
    );
  }
}
