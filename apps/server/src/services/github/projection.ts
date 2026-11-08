import type {
  EventOf,
  GitHubRepo,
  GithubEventType,
  GithubIssue,
  GithubPr,
  Project,
} from "@codeden/contracts";
import { eq } from "drizzle-orm";
import { githubIssues, githubPrs, githubSyncState } from "../../db/schema";
import type { Tx } from "../../events/projection-db";
import { sameGithubRepo } from "../projects/reconcile";
import { issueToRow, prToRow } from "./rows";

/** A persisted GitHub domain event. */
export type GithubEvent = EventOf<GithubEventType>;

/** True for the GitHub domain events (`github.synced`, `issue.*`, `pr.*`, `review.*`). */
export function isGithubEvent(e: { type: string }): e is GithubEvent {
  return (
    e.type === "github.synced" ||
    e.type.startsWith("issue.") ||
    e.type.startsWith("pr.") ||
    e.type === "review.submitted"
  );
}

function upsertIssue(tx: Tx, issue: GithubIssue, ts: string): void {
  const row = issueToRow(issue, ts);
  tx.insert(githubIssues)
    .values(row)
    .onConflictDoUpdate({ target: [githubIssues.projectId, githubIssues.number], set: row })
    .run();
}

function upsertPr(tx: Tx, pr: GithubPr, ts: string): void {
  const row = prToRow(pr, ts);
  tx.insert(githubPrs)
    .values(row)
    .onConflictDoUpdate({ target: [githubPrs.projectId, githubPrs.number], set: row })
    .run();
}

/**
 * True when a `project.updated` points an existing project at another GitHub repository, or
 * makes a local project a GitHub one. `before` is the stored row (`github` null when local).
 */
export function githubRepoChanged(
  before: { github: GitHubRepo | null } | undefined,
  next: Project,
): boolean {
  if (!before || next.kind !== "github") return false;
  return !before.github || !sameGithubRepo(before.github, next.github);
}

/**
 * Forget a project's synced issues and PRs and its sync cursors, so the next sync imports its
 * (new) repository from scratch, silently. Called inside the `project.updated` append when
 * `githubRepoChanged`, so a replay of the log does the same.
 */
export function resetGithubProjection(tx: Tx, projectId: string): void {
  tx.delete(githubIssues).where(eq(githubIssues.projectId, projectId)).run();
  tx.delete(githubPrs).where(eq(githubPrs.projectId, projectId)).run();
  tx.delete(githubSyncState).where(eq(githubSyncState.projectId, projectId)).run();
}

/**
 * Project a GitHub domain event into `github_issues` / `github_prs`, inside the append
 * transaction. Every event carries the full row, so replaying the log rebuilds both tables.
 */
export function applyGithubProjection(tx: Tx, e: GithubEvent): void {
  switch (e.type) {
    case "github.synced":
      for (const issue of e.payload.issues) upsertIssue(tx, issue, e.ts);
      for (const pr of e.payload.prs) upsertPr(tx, pr, e.ts);
      return;
    case "issue.opened":
    case "issue.labeled":
    case "issue.updated":
    case "issue.commented":
      upsertIssue(tx, e.payload.issue, e.ts);
      return;
    default:
      upsertPr(tx, e.payload.pr, e.ts);
  }
}
