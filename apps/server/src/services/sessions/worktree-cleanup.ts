import type {
  ArchiveSessionResponse,
  RawEventEnvelope,
  Session,
  SessionStatus,
  Settings,
  WorktreeCleanupOutcome,
} from "@codeden/contracts";
import type { EventStore } from "../../events/store";
import { badRequest, errorMessage } from "../errors";
import type { ProjectService } from "../projects/project-service";
import { type RunnerPort, runnerErrorCode } from "../runner-port";
import type { SessionRepo } from "./repo";

export interface WorktreeCleanupDeps {
  repo: SessionRepo;
  projects: ProjectService;
  runner: RunnerPort;
  store: EventStore;
  settings: () => Settings;
  /** Stops a session (provider turn, queued messages, open approvals) before it is archived. */
  stopSession: (id: string) => Promise<unknown>;
  now?: () => Date;
  /** How often the inactivity sweep runs (default hourly). */
  intervalMs?: number;
  /** Delay before the first sweep after start (default one minute). */
  initialDelayMs?: number;
  log?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const REMOVE_TIMEOUT_MS = 2 * 60_000;
/** Sessions that may be using their worktree right now; never cleaned up. */
const IN_USE: ReadonlySet<SessionStatus> = new Set([
  "created",
  "queued",
  "starting",
  "running",
  "waiting",
]);

const outcome = (
  status: WorktreeCleanupOutcome["status"],
  message: string | null = null,
): WorktreeCleanupOutcome => ({ status, message });

/**
 * Whether the sweep should remove a session's worktree now: an agent session that owns a
 * worktree it is not using, and is either archived or has been inactive for `afterDays`
 * without an open pull request. Archived sessions are retried even with cleanup off.
 */
export function cleanupDue(session: Session, now: Date, settings: Settings["worktrees"]): boolean {
  if (session.role !== "agent" || !session.projectId) return false;
  if (!session.worktreePath || session.worktreeRemovedAt) return false;
  if (IN_USE.has(session.status)) return false;
  if (session.archivedAt) return true;
  if (!settings.cleanup) return false;
  if (session.pr && (session.pr.state === "open" || session.pr.state === "draft")) return false;
  return now.getTime() - Date.parse(session.updatedAt) >= settings.afterDays * DAY_MS;
}

/**
 * Worktree cleanup (§9). Archiving a session removes its worktree right away; an hourly sweep
 * removes worktrees of sessions inactive for the configured number of days; archiving a project
 * cleans up its sessions. Everything goes through the runner's workspace commands, so a remote
 * runner cleans up its own storage. Uncommitted changes always keep a worktree unless forced.
 * The branch and checkpoints stay, and the next message recreates the worktree.
 */
export class WorktreeCleanup {
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private sweeping = false;
  /** Sessions the sweep could not clean (dirty, locked), keyed to the `updatedAt` it saw. */
  private readonly kept = new Map<string, string>();

  constructor(private readonly deps: WorktreeCleanupDeps) {}

  start(): void {
    this.unsubscribe = this.deps.store.subscribe((events) => {
      setImmediate(() => this.onEvents(events));
    });
    const interval = this.deps.intervalMs ?? 60 * 60_000;
    const first = setTimeout(() => {
      void this.sweep();
      this.timer = setInterval(() => void this.sweep(), interval);
      this.timer.unref?.();
    }, this.deps.initialDelayMs ?? 60_000);
    first.unref?.();
    this.timer = first;
  }

  stop(): void {
    this.unsubscribe?.();
    clearTimeout(this.timer);
    clearInterval(this.timer);
  }

  /** Stop the session if needed, hide it from the sidebar and remove its worktree. */
  async archive(id: string, opts: { force?: boolean } = {}): Promise<ArchiveSessionResponse> {
    const current = this.deps.repo.get(id);
    if (current.role !== "agent") {
      throw badRequest("Only agent sessions can be archived", "not_archivable");
    }
    if (IN_USE.has(current.status) || current.status === "idle") {
      await this.deps.stopSession(id);
    }
    this.deps.repo.update(id, (s) =>
      s.archivedAt ? s : { ...s, archivedAt: this.now().toISOString() },
    );
    const worktree = await this.removeWorktree(id, { force: opts.force === true });
    return { session: this.deps.repo.get(id), worktree };
  }

  /** Show an archived session again. Its worktree comes back with the next message. */
  unarchive(id: string): Session {
    return this.deps.repo.update(id, (s) => (s.archivedAt ? { ...s, archivedAt: null } : s));
  }

  /**
   * Remove a session's worktree through the runner. Refuses while the session is in use, and
   * keeps a worktree with uncommitted changes unless `force`.
   */
  async removeWorktree(id: string, opts: { force: boolean }): Promise<WorktreeCleanupOutcome> {
    const session = this.deps.repo.get(id);
    if (!session.worktreePath || session.worktreeRemovedAt || !session.projectId) {
      return outcome("none");
    }
    if (IN_USE.has(session.status)) {
      return outcome("failed", "The session is still working; stop it first");
    }
    let repoPath: string;
    try {
      repoPath = this.deps.projects.get(session.projectId).path;
    } catch {
      return outcome("none");
    }
    if (!this.deps.runner.isConnected()) {
      return outcome("failed", "The runner is not connected; cleanup will retry later");
    }
    // The provider process runs in the worktree; detach it before the folder goes away.
    await this.deps.runner
      .request({ name: "session.stop", sessionId: id }, 15_000)
      .catch(() => undefined);
    try {
      await this.deps.runner.request(
        { name: "workspace.remove", repoPath, path: session.worktreePath, force: opts.force },
        REMOVE_TIMEOUT_MS,
      );
    } catch (error) {
      const message = errorMessage(error);
      if (runnerErrorCode(error) === "worktree_dirty" || /modified or untracked/.test(message)) {
        return outcome("kept_changes", "The worktree has uncommitted changes, so it was kept");
      }
      return outcome("failed", message);
    }
    this.deps.repo.update(id, (s) => ({ ...s, worktreeRemovedAt: this.now().toISOString() }));
    this.kept.delete(id);
    this.deps.log?.(`worktree cleanup: removed ${session.worktreePath}`);
    return outcome("removed");
  }

  /** Remove every worktree that is due (see `cleanupDue`). Returns the cleaned session ids. */
  async sweep(): Promise<string[]> {
    if (this.sweeping || !this.deps.runner.isConnected()) return [];
    this.sweeping = true;
    const removed: string[] = [];
    try {
      const now = this.now();
      const settings = this.deps.settings().worktrees;
      for (const session of this.deps.repo.list({ role: "agent" })) {
        if (!cleanupDue(session, now, settings)) continue;
        if (this.kept.get(session.id) === session.updatedAt) continue;
        const result = await this.removeWorktree(session.id, { force: false });
        if (result.status === "removed") removed.push(session.id);
        else if (result.status !== "none") {
          this.kept.set(session.id, this.deps.repo.get(session.id).updatedAt);
        }
      }
    } catch (error) {
      this.deps.log?.(`worktree cleanup failed: ${errorMessage(error)}`);
    } finally {
      this.sweeping = false;
    }
    return removed;
  }

  /** Clean up the worktrees of an archived project's sessions that are not in use. */
  async cleanProject(projectId: string): Promise<string[]> {
    const removed: string[] = [];
    for (const session of this.deps.repo.list({ projectId, role: "agent" })) {
      if (!session.worktreePath || session.worktreeRemovedAt || IN_USE.has(session.status)) {
        continue;
      }
      const result = await this.removeWorktree(session.id, { force: false });
      if (result.status === "removed") removed.push(session.id);
    }
    return removed;
  }

  private onEvents(events: RawEventEnvelope[]): void {
    for (const e of events) {
      if (e.type !== "project.archived") continue;
      const projectId = (e.payload as { projectId?: unknown }).projectId;
      if (typeof projectId === "string") {
        void this.cleanProject(projectId).catch((error: unknown) =>
          this.deps.log?.(`worktree cleanup for project ${projectId}: ${errorMessage(error)}`),
        );
      }
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
