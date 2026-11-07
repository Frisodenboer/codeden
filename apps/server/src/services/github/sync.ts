import {
  type GitHubRepo,
  GithubIssue,
  GithubPr,
  type GithubSyncStatus,
  type NewEvent,
  type Project,
} from "@codeden/contracts";
import type { EventStore } from "../../events/store";
import { errorMessage } from "../errors";
import { type GithubClient, GithubNotConnectedError, GithubRateLimitError } from "./client";
import { diffIssue, diffPr, type RestIssue, toGithubIssue } from "./diff";
import { fetchPullRequests, type GqlPullRequest, toGithubPr } from "./graphql";
import type { GithubStore, SyncState } from "./store";

export interface GithubSyncDeps {
  client: GithubClient;
  store: GithubStore;
  events: EventStore;
  /** Projects to sync (only `github` projects that are not archived are used). */
  projects: () => Project[];
  /** Poll interval with no session PR open (default 60 s). */
  idleIntervalMs?: number;
  /** Poll interval while a session has an open PR (default 15 s). */
  activeIntervalMs?: number;
  /** How often the scheduler checks for due projects (default 5 s). */
  tickMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

interface Schedule {
  nextAt: number;
  intervalMs: number;
  failures: number;
  ticks: number;
}

const ENDED = new Set(["completed", "failed", "stopped"]);
const MAX_BACKOFF_MS = 15 * 60_000;
const BASELINE_OPEN_PAGES = 5;
const BASELINE_CLOSED_DAYS = 30;
const BODY_LIMIT = 20_000;

/**
 * Polls GitHub for each GitHub project (§9): the issues listing with `If-None-Match` (a 304
 * costs nothing), then batched GraphQL for the PRs that changed or still have pending checks.
 * Differences become domain events, appended (with their projections) in one transaction. The
 * interval adapts: fast while a session's PR is open, slow otherwise, backing off on errors.
 */
export class GithubSync {
  private timer: NodeJS.Timeout | undefined;
  private readonly schedules = new Map<string, Schedule>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: GithubSyncDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.deps.tickMs ?? 5_000);
    this.timer.unref();
    setImmediate(() => this.tick());
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Sync one project now (joins a sync already in flight). */
  syncProject(projectId: string): Promise<void> {
    const inFlight = this.running.get(projectId);
    if (inFlight) return inFlight;
    const project = this.githubProjects().find((p) => p.id === projectId);
    if (project?.kind !== "github") return Promise.resolve();
    const run = this.runSync(project.id, project.github).finally(() =>
      this.running.delete(projectId),
    );
    this.running.set(projectId, run);
    return run;
  }

  /** Poll this project at the next scheduler tick (after creating a PR, merging, ...). */
  soon(projectId: string): void {
    const schedule = this.schedules.get(projectId);
    if (schedule) schedule.nextAt = 0;
  }

  status(projectId: string): GithubSyncStatus {
    const state = this.deps.store.syncState(projectId);
    const schedule = this.schedules.get(projectId);
    return {
      projectId,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
      intervalMs: schedule?.intervalMs ?? this.idleMs(),
      nextSyncAt: schedule ? new Date(Math.max(schedule.nextAt, this.now())).toISOString() : null,
    };
  }

  private tick(): void {
    const now = this.now();
    for (const project of this.githubProjects()) {
      const schedule = this.schedule(project.id);
      if (now >= schedule.nextAt && !this.running.has(project.id)) {
        void this.syncProject(project.id).catch(() => undefined);
      }
    }
  }

  private githubProjects(): Project[] {
    return this.deps.projects().filter((p) => p.kind === "github" && p.archivedAt === null);
  }

  private schedule(projectId: string): Schedule {
    let schedule = this.schedules.get(projectId);
    if (!schedule) {
      schedule = { nextAt: 0, intervalMs: this.idleMs(), failures: 0, ticks: 0 };
      this.schedules.set(projectId, schedule);
    }
    return schedule;
  }

  private async runSync(projectId: string, repo: GitHubRepo): Promise<void> {
    const schedule = this.schedule(projectId);
    const state = this.deps.store.syncState(projectId);
    try {
      if (!state.baselineAt) await this.baseline(projectId, repo, state);
      else await this.incremental(projectId, repo, state, schedule.ticks);
      state.lastError = null;
      schedule.failures = 0;
      schedule.ticks++;
      schedule.intervalMs = this.hasActiveSessionPr(projectId)
        ? (this.deps.activeIntervalMs ?? 15_000)
        : this.idleMs();
      schedule.nextAt = this.now() + schedule.intervalMs;
    } catch (error) {
      schedule.failures++;
      state.lastError = errorMessage(error);
      if (error instanceof GithubRateLimitError) {
        schedule.nextAt = Math.max(error.resetAt, this.now() + 60_000);
      } else if (error instanceof GithubNotConnectedError) {
        schedule.nextAt = this.now() + 5 * 60_000;
      } else {
        const backoff = Math.min(this.idleMs() * 2 ** (schedule.failures - 1), MAX_BACKOFF_MS);
        schedule.nextAt = this.now() + backoff;
        this.deps.log?.(`github sync ${repo.owner}/${repo.repo}: ${state.lastError}`);
      }
      throw error;
    } finally {
      state.lastSyncAt = new Date(this.now()).toISOString();
      this.deps.store.saveSyncState(projectId, state);
    }
  }

  /** First import: open issues and PRs plus recently closed ones, as one silent event. */
  private async baseline(projectId: string, repo: GitHubRepo, state: SyncState): Promise<void> {
    const listed: RestIssue[] = [];
    await this.deps.client.run(async (octokit) => {
      for (let page = 1; page <= BASELINE_OPEN_PAGES; page++) {
        const res = await octokit.rest.issues.listForRepo({
          owner: repo.owner,
          repo: repo.repo,
          state: "open",
          per_page: 100,
          page,
        });
        listed.push(...(res.data as RestIssue[]));
        if (res.data.length < 100) break;
      }
      const since = new Date(this.now() - BASELINE_CLOSED_DAYS * 86_400_000).toISOString();
      const closed = await octokit.rest.issues.listForRepo({
        owner: repo.owner,
        repo: repo.repo,
        state: "closed",
        sort: "updated",
        since,
        per_page: 100,
      });
      listed.push(...(closed.data as RestIssue[]));
    });
    const issues = listed.filter((i) => !i.pull_request).map((i) => this.issueOf(projectId, i));
    const prNodes = await fetchPullRequests(
      this.deps.client,
      repo.owner,
      repo.repo,
      listed.filter((i) => i.pull_request).map((i) => i.number),
    );
    const prs = prNodes.map((node) => this.prOf(projectId, node, undefined));
    this.deps.events.append([
      { type: "github.synced", sessionId: null, payload: { projectId, issues, prs } },
    ]);
    state.since = maxUpdated(listed, state.since);
    // On GitHub's clock when possible: items created after this are new, not imported.
    state.baselineAt = state.since ?? new Date(this.now()).toISOString();
    state.etags = {};
  }

  private async incremental(
    projectId: string,
    repo: GitHubRepo,
    state: SyncState,
    tick: number,
  ): Promise<void> {
    const key = `issues?since=${state.since ?? ""}`;
    const res = await this.deps.client.conditionalGet<RestIssue[]>(
      "GET /repos/{owner}/{repo}/issues",
      {
        owner: repo.owner,
        repo: repo.repo,
        state: "all",
        sort: "updated",
        direction: "asc",
        per_page: 100,
        ...(state.since ? { since: state.since } : {}),
      },
      state.etags[key],
    );
    const events: NewEvent[] = [];
    const changedPrs = new Set<number>();
    if (res.status === 200) {
      for (const raw of res.data) {
        if (raw.pull_request) {
          changedPrs.add(raw.number);
          continue;
        }
        const next = this.issueOf(projectId, raw);
        const prev = this.deps.store.issue(projectId, raw.number);
        events.push(...diffIssue(prev, next, { importedBefore: state.baselineAt }));
      }
      const since = maxUpdated(res.data, state.since);
      // Only the current cursor's ETag is useful; a moved cursor starts fresh.
      state.etags = since === state.since && res.etag ? { [key]: res.etag } : {};
      state.since = since;
    }

    const open = this.deps.store.prs(projectId, "open");
    const refresh = new Set(changedPrs);
    for (const pr of open) {
      const unsettled = pr.checks.state === "pending" || pr.mergeable === "unknown";
      if (unsettled || pr.sessionId !== null || tick % 4 === 0) refresh.add(pr.number);
    }
    if (refresh.size > 0) {
      const nodes = await fetchPullRequests(this.deps.client, repo.owner, repo.repo, [...refresh]);
      for (const node of nodes) {
        const prev = this.deps.store.pr(projectId, node.number);
        const next = this.prOf(projectId, node, prev);
        events.push(...diffPr(prev, next, { importedBefore: state.baselineAt }));
      }
    }
    if (events.length > 0) this.deps.events.append(events);
  }

  private issueOf(projectId: string, raw: RestIssue): GithubIssue {
    const issue = toGithubIssue(projectId, raw);
    if (issue.body && issue.body.length > BODY_LIMIT) issue.body = issue.body.slice(0, BODY_LIMIT);
    return GithubIssue.parse(issue);
  }

  /** Map a PR and link it to its session: kept from before, or the session on its branch. */
  private prOf(projectId: string, node: GqlPullRequest, prev: GithubPr | undefined): GithubPr {
    let sessionId = prev?.sessionId ?? null;
    if (!sessionId) {
      const owner = this.deps.store
        .projectSessions(projectId)
        .filter((s) => s.branch === node.headRefName || s.pr?.number === node.number)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      sessionId = owner?.id ?? null;
    }
    return GithubPr.parse(toGithubPr(projectId, node, sessionId));
  }

  private hasActiveSessionPr(projectId: string): boolean {
    const sessions = new Map(this.deps.store.projectSessions(projectId).map((s) => [s.id, s]));
    return this.deps.store.prs(projectId, "open").some((pr) => {
      const session = pr.sessionId ? sessions.get(pr.sessionId) : undefined;
      return session !== undefined && !ENDED.has(session.status);
    });
  }

  private idleMs(): number {
    return this.deps.idleIntervalMs ?? 60_000;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function maxUpdated(items: Array<{ updated_at: string }>, current: string | null): string | null {
  let max = current;
  for (const item of items) if (!max || item.updated_at > max) max = item.updated_at;
  return max;
}
