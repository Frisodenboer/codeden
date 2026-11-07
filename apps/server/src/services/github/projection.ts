import type { EventOf, GithubEventType, GithubIssue, GithubPr } from "@codeden/contracts";
import { githubIssues, githubPrs } from "../../db/schema";
import type { Tx } from "../../events/projection-db";
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
