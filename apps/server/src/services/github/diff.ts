import type { GithubIssue, GithubPr, NewEvent } from "@codeden/contracts";

/**
 * Turn "what we had" vs "what GitHub says now" into domain events (§9, §10 triggers). Pure, so
 * the sync's event semantics are unit-tested without a network.
 */

/** A REST issue as listed by `GET /repos/{owner}/{repo}/issues` (PRs carry `pull_request`). */
export interface RestIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels: Array<string | { name?: string | null }>;
  user: { login: string } | null;
  body?: string | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

export function toGithubIssue(projectId: string, raw: RestIssue): GithubIssue {
  return {
    projectId,
    number: raw.number,
    title: raw.title,
    state: raw.state === "closed" ? "closed" : "open",
    url: raw.html_url,
    labels: raw.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter((l) => l.length > 0),
    author: raw.user?.login ?? null,
    body: raw.body ?? null,
    comments: raw.comments,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at,
    sessionIds: [],
  };
}

/**
 * Options for items seen for the first time. `importedBefore`: when the project's first
 * import ran; an unknown item created before it is old news (`*.updated` with `imported`),
 * not a newly opened one.
 */
export interface DiffOptions {
  importedBefore?: string | null;
}

function isOld(createdAt: string | null, opts: DiffOptions): boolean {
  return Boolean(createdAt && opts.importedBefore && createdAt < opts.importedBefore);
}

/** Events for one issue: opened, labeled (labels added) or updated (anything else). */
export function diffIssue(
  prev: GithubIssue | undefined,
  next: GithubIssue,
  opts: DiffOptions = {},
): NewEvent[] {
  const issue = { ...next, sessionIds: [] };
  if (!prev && isOld(next.createdAt, opts)) {
    return [{ type: "issue.updated", sessionId: null, payload: { issue, changes: ["imported"] } }];
  }
  if (!prev) return [{ type: "issue.opened", sessionId: null, payload: { issue } }];
  const added = next.labels.filter((l) => !prev.labels.includes(l));
  const changes: string[] = [];
  if (prev.title !== next.title) changes.push("title");
  if ((prev.body ?? "") !== (next.body ?? "")) changes.push("body");
  if (prev.state !== next.state) changes.push("state");
  if (next.labels.length !== prev.labels.length + added.length) changes.push("labels");
  if (prev.comments !== next.comments) changes.push("comments");
  const events: NewEvent[] = [];
  if (added.length > 0) {
    events.push({ type: "issue.labeled", sessionId: null, payload: { issue, added } });
  }
  if (changes.length > 0) {
    events.push({ type: "issue.updated", sessionId: null, payload: { issue, changes } });
  }
  return events;
}

const PR_FIELDS: Array<keyof GithubPr> = [
  "title",
  "state",
  "headSha",
  "baseBranch",
  "reviewDecision",
  "mergeable",
  "linkedIssues",
  "sessionId",
];

/**
 * Events for one PR. Terminal transitions (merged, closed) and check outcomes get their own
 * event; new reviews become `review.submitted`; other field changes become `pr.updated`.
 * Each event carries the latest row, so applying any one of them leaves the projection current.
 */
export function diffPr(
  prev: GithubPr | undefined,
  next: GithubPr,
  opts: DiffOptions = {},
): NewEvent[] {
  const sessionId = next.sessionId;
  const pr = next;
  if (!prev && isOld(next.createdAt, opts)) {
    return [{ type: "pr.updated", sessionId, payload: { pr, changes: ["imported"] } }];
  }
  if (!prev) {
    const events: NewEvent[] = [{ type: "pr.opened", sessionId, payload: { pr } }];
    if (next.state === "merged") events.push({ type: "pr.merged", sessionId, payload: { pr } });
    else if (next.state === "closed")
      events.push({ type: "pr.closed", sessionId, payload: { pr } });
    return events;
  }
  const events: NewEvent[] = [];
  const seen = new Set(prev.reviews.map((r) => r.id));
  for (const review of next.reviews) {
    if (!seen.has(review.id) && review.state !== "pending") {
      events.push({ type: "review.submitted", sessionId, payload: { pr, review } });
    }
  }
  let changes: string[] = PR_FIELDS.filter(
    (f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f]),
  );
  if (prev.checks.state !== next.checks.state) changes.push("checks");
  const checksChanged = prev.checks.state !== next.checks.state || prev.headSha !== next.headSha;
  if (checksChanged && next.checks.state === "success") {
    events.push({ type: "pr.checks_passed", sessionId, payload: { pr } });
    changes = changes.filter((c) => c !== "checks");
  } else if (checksChanged && next.checks.state === "failure") {
    events.push({ type: "pr.checks_failed", sessionId, payload: { pr } });
    changes = changes.filter((c) => c !== "checks");
  }
  if (prev.state !== "merged" && next.state === "merged") {
    events.push({ type: "pr.merged", sessionId, payload: { pr } });
    changes = changes.filter((c) => c !== "state");
  } else if (prev.state !== "closed" && next.state === "closed") {
    events.push({ type: "pr.closed", sessionId, payload: { pr } });
    changes = changes.filter((c) => c !== "state");
  }
  // Keep the projection current even when only incidental fields changed (checks list, commits).
  const incidental =
    events.length === 0 && changes.length === 0 && JSON.stringify(prev) !== JSON.stringify(next);
  if (changes.length > 0 || incidental) {
    events.push({
      type: "pr.updated",
      sessionId,
      payload: { pr, changes: changes.length > 0 ? changes : ["details"] },
    });
  }
  return events;
}
