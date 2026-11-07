import type {
  Automation,
  AutomationEventName,
  GithubIssue,
  GithubPr,
  Notice,
  RawEventEnvelope,
  Session,
} from "@codeden/contracts";
import { issueVars, prVars, sessionVars, type TemplateVars } from "./prompt";

/** A domain event an automation trigger can match. */
export interface TriggerEvent {
  event: AutomationEventName;
  projectId: string;
  vars: TemplateVars;
  issue?: GithubIssue;
  /** Labels to match `filter.labels` against (an issue's labels, or the ones just added). */
  labels: string[];
  branch: string | null;
  author: string | null;
  /** The session the event is about (session.* events, session-owned PRs). */
  sessionId: string | null;
}

const NOTICE_EVENTS: Partial<Record<Notice["type"], AutomationEventName>> = {
  "session.finished": "session.finished",
  "session.failed": "session.failed",
  "session.needs_input": "session.needs_input",
};

const PR_EVENTS = new Set(["pr.opened", "pr.merged", "pr.checks_failed"]);

/**
 * Trigger events from a batch of committed events: GitHub sync events (`issue.opened`,
 * `issue.labeled`, `pr.opened`, `pr.merged`, `pr.checks_failed`) and session notices
 * (`session.finished`, `session.failed`, `session.needs_input`), which already carry the
 * project and are de-duplicated by the notice store.
 */
export function triggerEvents(
  events: RawEventEnvelope[],
  session: (id: string) => Session | undefined,
): TriggerEvent[] {
  const out: TriggerEvent[] = [];
  for (const e of events) {
    if (e.type === "issue.opened" || e.type === "issue.labeled") {
      const { issue, added } = e.payload as { issue: GithubIssue; added?: string[] };
      out.push({
        event: e.type,
        projectId: issue.projectId,
        vars: issueVars(issue),
        issue,
        labels: e.type === "issue.labeled" ? (added ?? []) : issue.labels,
        branch: null,
        author: issue.author,
        sessionId: null,
      });
    } else if (PR_EVENTS.has(e.type)) {
      const { pr } = e.payload as { pr: GithubPr };
      out.push({
        event: e.type as AutomationEventName,
        projectId: pr.projectId,
        vars: prVars(pr),
        labels: [],
        branch: pr.headBranch,
        author: pr.author,
        sessionId: pr.sessionId,
      });
    } else if (e.type === "notice.created") {
      const { notice } = e.payload as { notice: Notice };
      const event = NOTICE_EVENTS[notice.type];
      if (!event || !notice.projectId || !notice.sessionId) continue;
      const s = session(notice.sessionId);
      if (!s) continue;
      out.push({
        event,
        projectId: notice.projectId,
        vars: sessionVars(s),
        labels: [],
        branch: s.branch,
        author: null,
        sessionId: s.id,
      });
    }
  }
  return out;
}

/** True when `automation`'s event trigger matches `event` (name and filter). */
export function triggerMatches(automation: Automation, event: TriggerEvent): boolean {
  const trigger = automation.trigger;
  if (trigger.type !== "event" || trigger.event !== event.event) return false;
  const filter = trigger.filter;
  if (filter?.labels?.length) {
    const wanted = new Set(filter.labels.map((l) => l.toLowerCase()));
    if (!event.labels.some((l) => wanted.has(l.toLowerCase()))) return false;
  }
  if (filter?.branches?.length && !(event.branch && filter.branches.includes(event.branch))) {
    return false;
  }
  if (filter?.authors?.length && !(event.author && filter.authors.includes(event.author))) {
    return false;
  }
  return true;
}

/**
 * Loop guard: an automation is never triggered by work it started itself (a `session.finished`
 * automation would otherwise re-trigger on its own session).
 */
export function startedByAutomation(
  automation: Automation,
  event: TriggerEvent,
  session: (id: string) => Session | undefined,
): boolean {
  if (!event.sessionId) return false;
  const s = session(event.sessionId);
  return s?.startedBy.kind === "automation" && s.startedBy.id === automation.id;
}
