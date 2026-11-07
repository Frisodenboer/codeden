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

/** Plain names of the events an automation can react to (§10). */
export const EVENT_LABEL: Record<AutomationEventName, string> = {
  "session.finished": "A session finishes",
  "session.failed": "A session fails",
  "session.needs_input": "A session needs input",
  "pr.opened": "A pull request opens",
  "pr.merged": "A pull request merges",
  "pr.checks_failed": "PR checks fail",
  "pr.review_requested": "A review is requested",
  "issue.opened": "An issue opens",
  "issue.labeled": "An issue is labeled",
  "issue.commented": "An issue gets a comment",
};

/** "Every Monday at 03:00", "When a pull request opens", "Manual only". */
export function describeTrigger(t: AutomationTrigger): string {
  if (t.type === "manual") return "Manual only";
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
  global_file: "Global file",
  project_file: "Repo file",
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
