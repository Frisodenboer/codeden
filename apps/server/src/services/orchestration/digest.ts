import type {
  InboxItem,
  Notice,
  Overview,
  Project,
  ProjectStatus,
  RecentOutcome,
  ScheduledRun,
  WorkSummary,
} from "@codeden/contracts";

/**
 * The status digest (§8.4): structured data (`ProjectStatus`, `Overview`) and its compact
 * text form, prepended to every orchestrator and PM wake so they know the current state
 * without spending a tool call.
 */

const DAY_MS = 24 * 60 * 60_000;

/** What a digest is built from; gathered by the orchestration service. */
export interface ProjectStatusInput {
  project: Project;
  /** Running or queued agent work (role sessions already excluded). */
  work: WorkSummary[];
  scheduled: ScheduledRun[];
  inbox: InboxItem[];
  /** `session.finished` / `session.failed` notices of the last day, newest first. */
  outcomes: Notice[];
}

export function buildProjectStatus(input: ProjectStatusInput): ProjectStatus {
  const recent = input.outcomes.flatMap((n): RecentOutcome[] => {
    if (n.type === "session.finished") {
      return [
        {
          sessionId: n.data.sessionId,
          workKey: n.data.workKey,
          purpose: n.data.purpose,
          outcome: "finished",
          summary: n.data.summary,
          at: n.createdAt,
        },
      ];
    }
    if (n.type === "session.failed") {
      return [
        {
          sessionId: n.data.sessionId,
          workKey: n.data.workKey,
          purpose: n.data.purpose,
          outcome: "failed",
          summary: n.data.error,
          at: n.createdAt,
        },
      ];
    }
    return [];
  });
  return {
    project: { id: input.project.id, name: input.project.name, kind: input.project.kind },
    running: input.work.filter((w) => w.status !== "queued"),
    queued: input.work.filter((w) => w.status === "queued"),
    scheduled: input.scheduled.slice(0, 5),
    inbox: {
      open: input.inbox.length,
      items: input.inbox.slice(0, 8).map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        sessionId: i.sessionId,
      })),
    },
    recent: recent.slice(0, 5),
  };
}

/** Work keys running in more than one project at once (cross-project view). */
export function sharedWork(projects: ProjectStatus[]): Overview["sharedWork"] {
  const byKey = new Map<string, Set<string>>();
  for (const p of projects) {
    for (const w of [...p.running, ...p.queued]) {
      const set = byKey.get(w.workKey) ?? new Set<string>();
      set.add(p.project.id);
      byKey.set(w.workKey, set);
    }
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([workKey, ids]) => ({ workKey, projectIds: [...ids] }));
}

/** `14m`, `3h`, `2d`. */
export function age(from: string, now: number): string {
  const sec = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

const short = (id: string) => id.slice(0, 8);
const quote = (text: string, max = 100) =>
  `"${text.length > max ? `${text.slice(0, max - 3)}...` : text}"`;

function workLine(w: WorkSummary, now: number): string {
  const parts = [
    `- ${w.workKey}`,
    `${w.status} ${age(w.startedAt, now)}`,
    quote(w.purpose),
    w.progress ? `progress: ${quote(w.progress.text, 120)} (${age(w.progress.at, now)} ago)` : "",
    w.sessionId ? `session ${short(w.sessionId)}` : `run ${short(w.id)}`,
    `by ${w.startedBy.kind}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

function projectLines(s: ProjectStatus, now: number, indent = ""): string[] {
  const lines: string[] = [];
  const push = (line: string) => lines.push(`${indent}${line}`);
  push(s.running.length ? `Running (${s.running.length}):` : "Running: none");
  for (const w of s.running) push(workLine(w, now));
  if (s.queued.length) {
    push(`Queued (${s.queued.length}):`);
    for (const w of s.queued) push(workLine(w, now));
  }
  push(
    s.scheduled.length
      ? `Next scheduled: ${s.scheduled
          .map((r) => `${r.name} (${r.workKey}) at ${r.at}${r.skipped ? " [skipped]" : ""}`)
          .join("; ")}`
      : "Next scheduled: none",
  );
  push(
    s.inbox.open
      ? `Inbox (${s.inbox.open} open): ${s.inbox.items.map((i) => `${i.kind}: ${quote(i.title, 80)}`).join("; ")}`
      : "Inbox: empty",
  );
  if (s.recent.length) {
    push("Recent (24h):");
    for (const r of s.recent) {
      const summary = r.summary ? ` · ${quote(r.summary, 140)}` : "";
      push(`- ${r.outcome} ${r.workKey} ${quote(r.purpose)} ${age(r.at, now)} ago${summary}`);
    }
  }
  return lines;
}

/** The PM's digest for its project. */
export function renderProjectDigest(s: ProjectStatus, now = Date.now()): string {
  const at = new Date(now).toISOString();
  return [
    `<codeden_status project=${quote(s.project.name)} at="${at}">`,
    ...projectLines(s, now),
    "</codeden_status>",
  ].join("\n");
}

/** The orchestrator's digest: every project rolled up. */
export function renderOverviewDigest(o: Overview, now = Date.now()): string {
  const lines = [`<codeden_status scope="all projects" at="${new Date(now).toISOString()}">`];
  if (o.projects.length === 0) lines.push("No projects yet.");
  for (const p of o.projects) {
    lines.push(`## ${p.project.name} (${p.project.id})`);
    lines.push(...projectLines(p, now));
  }
  if (o.sharedWork.length) {
    lines.push(
      `Same work in several projects: ${o.sharedWork.map((s) => `${s.workKey} (${s.projectIds.length} projects)`).join("; ")}`,
    );
  }
  if (o.pmMessages.length) {
    lines.push("Informational PM messages:");
    for (const m of o.pmMessages) lines.push(`- ${m.projectId ?? "?"}: ${quote(m.text, 300)}`);
  }
  lines.push("</codeden_status>");
  return lines.join("\n");
}

/** "Updates since your last turn": one line per notice, for the model. */
export function renderNotices(list: Notice[], projectName?: (id: string) => string): string {
  const lines = ["Updates since your last turn:"];
  for (const n of list) {
    const where = n.projectId && projectName ? ` [${projectName(n.projectId)}]` : "";
    lines.push(`- (${n.type})${where} ${n.title}${noticeDetail(n)}`);
  }
  return lines.join("\n");
}

function noticeDetail(n: Notice): string {
  switch (n.type) {
    case "session.finished":
      return ` · ${n.data.workKey} · session ${short(n.data.sessionId)}${n.data.summary ? ` · ${quote(n.data.summary, 200)}` : ""}`;
    case "session.needs_input":
      return ` · ${n.data.kind}: ${quote(n.data.question, 200)} (waiting in the user's inbox)`;
    case "session.failed":
      return ` · ${n.data.workKey} · ${quote(n.data.error, 200)}`;
    case "pr.opened":
      return ` · ${n.data.pr.url}`;
    case "pr.checks_failed":
      return ` · ${n.data.pr.url} · failed: ${n.data.failedChecks.join(", ") || "unknown"}`;
    case "pr.checks_passed":
      return ` · ${n.data.pr.url}`;
    case "pr.merged":
      return ` · ${n.data.pr.url}${n.data.linkedIssues.length ? ` · closes ${n.data.linkedIssues.map((i) => `#${i}`).join(", ")}` : ""}`;
    case "review.submitted":
      return ` · ${n.data.pr.url} · ${n.data.reviewer ?? "someone"}${n.data.body ? `: ${quote(n.data.body, 200)}` : ""}`;
    case "issue.opened":
      return ` · ${n.data.issue.url}${n.data.labels.length ? ` · labels: ${n.data.labels.join(", ")}` : ""} (triage it)`;
    case "automation.skipped":
      return ` · ${n.data.workKey} · reason: ${n.data.reason}`;
    case "conflict":
      return ` · ${n.data.workKey} requested by ${n.data.requestedBy.kind}, matches ${n.data.existing.map((w) => w.workKey).join(", ")} (conflict ${short(n.data.conflictId)} waits in the user's inbox)`;
    case "pm.message":
      return ` · ${quote(n.data.text, 2000)}`;
    case "factory.update":
      return ` · ${n.data.event}\n${quote(n.data.text, 4000)}`;
  }
}

/** The day window for recent outcomes, from `now`. */
export function dayAgo(now = Date.now()): string {
  return new Date(now - DAY_MS).toISOString();
}
