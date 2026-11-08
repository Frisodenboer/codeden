import type {
  Automation,
  AutomationEventName,
  AutomationRun,
  AutomationRunStatus,
  AutomationTrigger,
  OverlapPolicy,
} from "@codeden/contracts";
import { describeCron } from "@/lib/cron";
import type { Tone } from "@/lib/format";

/** Plain names of the events an automation can react to (§10), read after "When". */
export const EVENT_LABEL: Record<AutomationEventName, string> = {
  "session.finished": "A session finishes its work",
  "session.failed": "A session fails",
  "session.needs_input": "A session is waiting on you",
  "pr.opened": "A pull request is opened",
  "pr.merged": "A pull request is merged",
  "pr.checks_failed": "A pull request's checks fail",
  "pr.review_requested": "A review is requested on a pull request",
  "issue.opened": "An issue is opened",
  "issue.labeled": "An issue is labelled",
  "issue.commented": "Someone comments on an issue",
};

/** A `{{placeholder}}` the prompt can use, with what it becomes. */
export interface Placeholder {
  token: string;
  label: string;
}

const ALWAYS: Placeholder[] = [
  { token: "{{project.name}}", label: "Project name" },
  { token: "{{date}}", label: "Today's date" },
  { token: "{{time}}", label: "Time of the run" },
];
const ISSUE: Placeholder[] = [
  { token: "{{issue.number}}", label: "Issue number" },
  { token: "{{issue.title}}", label: "Issue title" },
  { token: "{{issue.url}}", label: "Issue link" },
  { token: "{{issue.author}}", label: "Issue author" },
  { token: "{{issue.labels}}", label: "Issue labels" },
  { token: "{{issue.body}}", label: "Issue text" },
];
const COMMENT: Placeholder[] = [
  { token: "{{comment.author}}", label: "Comment author" },
  { token: "{{comment.body}}", label: "Comment text" },
  { token: "{{comment.url}}", label: "Comment link" },
];
const PR: Placeholder[] = [
  { token: "{{pr.number}}", label: "PR number" },
  { token: "{{pr.title}}", label: "PR title" },
  { token: "{{pr.url}}", label: "PR link" },
  { token: "{{pr.branch}}", label: "PR branch" },
  { token: "{{pr.base}}", label: "PR base branch" },
  { token: "{{pr.failedChecks}}", label: "Failed checks" },
  { token: "{{pr.reviewers}}", label: "Requested reviewers" },
];
const SESSION: Placeholder[] = [
  { token: "{{session.id}}", label: "Session id" },
  { token: "{{session.purpose}}", label: "Session purpose" },
  { token: "{{session.workKey}}", label: "Session work key" },
  { token: "{{session.summary}}", label: "Session summary" },
  { token: "{{session.outcome}}", label: "Session outcome" },
];

/** Placeholders a trigger fills: always the project and date, plus the event's fields. */
export function placeholdersFor(t: AutomationTrigger): { group: string; items: Placeholder[] }[] {
  const groups = [{ group: "Always", items: ALWAYS }];
  if (t.type !== "event") return groups;
  if (t.event.startsWith("issue.")) groups.push({ group: "Issue", items: ISSUE });
  if (t.event === "issue.commented") groups.push({ group: "Comment", items: COMMENT });
  if (t.event.startsWith("pr.")) groups.push({ group: "Pull request", items: PR });
  if (t.event.startsWith("session.")) groups.push({ group: "Session", items: SESSION });
  return groups;
}

/** "Every Monday at 03:00", "When a pull request is opened", "Only when you run it". */
export function describeTrigger(t: AutomationTrigger): string {
  if (t.type === "manual") return "Only when you run it";
  if (t.type === "event") return `When ${EVENT_LABEL[t.event].toLowerCase()}`;
  return describeCron(t.expression);
}

export const ACTION_LABEL: Record<Automation["action"]["type"], string> = {
  start_session: "Start an agent session",
  message_pm: "Message the PM",
  triage: "Triage the issue",
};

export const OVERLAP_LABEL: Record<OverlapPolicy, string> = {
  "skip-if-running": "Skip if running",
  queue: "Queue behind",
  "run-anyway": "Run anyway",
};

export const OVERLAP_HELP: Record<OverlapPolicy, string> = {
  "skip-if-running": "A trigger while matching work runs is recorded as skipped and the PM told.",
  queue: "The new run waits and starts when the running work finishes.",
  "run-anyway": "Starts alongside the running work.",
};

export const SOURCE_LABEL: Record<Automation["source"], string> = {
  builtin: "Built in",
  global_file: "From file",
  project_file: "From file",
  database: "CodeDen",
};

export const RUN_STATUS: Record<AutomationRunStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "idle" },
  running: { label: "Running", tone: "running" },
  completed: { label: "Completed", tone: "done" },
  failed: { label: "Failed", tone: "failed" },
  skipped: { label: "Skipped", tone: "waiting" },
  cancelled: { label: "Cancelled", tone: "idle" },
};

export const SKIP_REASON: Record<NonNullable<AutomationRun["skipReason"]>, string> = {
  overlap: "Previous run still going",
  concurrency: "Concurrency cap reached",
  quiet_hours: "Inside quiet hours",
  daily_cap: "Daily maximum reached",
  disabled: "Automation was off",
  skipped_by_pm: "Skipped ahead of time",
  conflict_skip: "Skipped on conflict",
  factory_intake: "The factory loop owns intake",
};

export const TRIGGERED_BY: Record<AutomationRun["triggeredBy"], string> = {
  cron: "Schedule",
  event: "Event",
  manual: "Manual",
  catch_up: "Catch-up",
};

/** Session-run actions with provider settings (the others run in the PM's chat). */
export function isSessionAction(
  a: Automation["action"],
): a is Extract<Automation["action"], { type: "start_session" }> {
  return a.type === "start_session";
}
