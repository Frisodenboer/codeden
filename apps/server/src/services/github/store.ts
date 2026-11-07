import type { GithubIssue, GithubPr, Session } from "@codeden/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToSession } from "../../db/rows";
import { githubIssues, githubPrs, githubSyncState, sessions } from "../../db/schema";
import { rowToIssue, rowToPr } from "./rows";

export type IssueStateFilter = "open" | "closed" | "all";

/** Sync cursors and ETags of one project (`github_sync_state`). */
export interface SyncState {
  etags: Record<string, string>;
  since: string | null;
  baselineAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

/** Reads of the GitHub projections and the operational sync state. */
export class GithubStore {
  constructor(private readonly db: Db) {}

  issues(projectId: string, state: IssueStateFilter = "open", limit = 500): GithubIssue[] {
    const rows = this.db
      .select()
      .from(githubIssues)
      .where(
        and(
          eq(githubIssues.projectId, projectId),
          state === "all" ? undefined : eq(githubIssues.state, state),
        ),
      )
      .orderBy(desc(githubIssues.updatedAt))
      .limit(limit)
      .all();
    const bySession = this.sessionsByIssue(projectId);
    return rows.map((r) => rowToIssue(r, bySession.get(r.number) ?? []));
  }

  issue(projectId: string, number: number): GithubIssue | undefined {
    const row = this.db
      .select()
      .from(githubIssues)
      .where(and(eq(githubIssues.projectId, projectId), eq(githubIssues.number, number)))
      .get();
    return row ? rowToIssue(row, this.sessionsByIssue(projectId).get(number) ?? []) : undefined;
  }

  /** `open` includes drafts; `closed` includes merged PRs. */
  prs(projectId: string, state: IssueStateFilter = "open", limit = 500): GithubPr[] {
    const states =
      state === "open" ? ["open", "draft"] : state === "closed" ? ["closed", "merged"] : undefined;
    return this.db
      .select()
      .from(githubPrs)
      .where(
        and(
          eq(githubPrs.projectId, projectId),
          states ? inArray(githubPrs.state, states) : undefined,
        ),
      )
      .orderBy(desc(githubPrs.updatedAt))
      .limit(limit)
      .all()
      .map(rowToPr);
  }

  pr(projectId: string, number: number): GithubPr | undefined {
    const row = this.db
      .select()
      .from(githubPrs)
      .where(and(eq(githubPrs.projectId, projectId), eq(githubPrs.number, number)))
      .get();
    return row ? rowToPr(row) : undefined;
  }

  /** Project sessions, for linking PRs to sessions by head branch. */
  projectSessions(projectId: string): Session[] {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .all()
      .map(rowToSession);
  }

  syncState(projectId: string): SyncState {
    const row = this.db
      .select()
      .from(githubSyncState)
      .where(eq(githubSyncState.projectId, projectId))
      .get();
    return {
      etags: row?.etags ?? {},
      since: row?.since ?? null,
      baselineAt: row?.baselineAt ?? null,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  saveSyncState(projectId: string, state: SyncState): void {
    const row = { projectId, ...state, updatedAt: new Date().toISOString() };
    this.db
      .insert(githubSyncState)
      .values(row)
      .onConflictDoUpdate({ target: githubSyncState.projectId, set: row })
      .run();
  }

  private sessionsByIssue(projectId: string): Map<number, string[]> {
    const map = new Map<number, string[]>();
    for (const s of this.projectSessions(projectId)) {
      if (!s.issue) continue;
      map.set(s.issue.number, [...(map.get(s.issue.number) ?? []), s.id]);
    }
    return map;
  }
}
