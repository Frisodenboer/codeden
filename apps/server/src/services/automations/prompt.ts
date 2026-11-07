import {
  type Automation,
  type GitHubIssueRef,
  type GithubIssue,
  type GithubPr,
  type Project,
  type Session,
  WorkKey,
} from "@codeden/contracts";
import { slugWords } from "../sessions/conflicts";
import { localDay, localTime } from "./cron";

/** Values for `{{placeholders}}` in prompts, messages and work keys. */
export type TemplateVars = Record<string, string>;

/** Replace `{{ key }}` with `vars[key]`; unknown keys become empty. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/** `project.name`, `project.id`, `date`, `time`, `datetime`. */
export function baseVars(project: Project, now: Date, timezone: string): TemplateVars {
  return {
    "project.id": project.id,
    "project.name": project.name,
    "project.path": project.path,
    date: localDay(now, timezone),
    time: localTime(now, timezone),
    datetime: now.toISOString(),
    timezone,
  };
}

export function issueVars(issue: GitHubIssueRef | GithubIssue): TemplateVars {
  const full = "labels" in issue ? issue : null;
  return {
    "issue.number": String(issue.number),
    "issue.title": issue.title ?? "",
    "issue.url": issue.url,
    "issue.author": full?.author ?? "",
    "issue.labels": full?.labels.join(", ") ?? "",
    "issue.body": full?.body ?? "",
  };
}

export function prVars(pr: GithubPr): TemplateVars {
  return {
    "pr.number": String(pr.number),
    "pr.title": pr.title,
    "pr.url": pr.url,
    "pr.author": pr.author ?? "",
    "pr.branch": pr.headBranch,
    "pr.base": pr.baseBranch,
    "pr.failedChecks": pr.checks.checks
      .filter((c) => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion))
      .map((c) => c.name)
      .join(", "),
  };
}

export function sessionVars(session: Session): TemplateVars {
  return {
    "session.id": session.id,
    "session.purpose": session.purpose,
    "session.workKey": session.workKey,
    "session.title": session.title ?? session.purpose,
    "session.outcome": session.result?.outcome ?? "",
    "session.summary": session.result?.summary ?? "",
    "session.branch": session.branch ?? "",
  };
}

/** `automation:<template id or name slug>`. */
export function defaultWorkKey(automation: Pick<Automation, "templateId" | "name">): string {
  return `automation:${automation.templateId ?? slugWords(automation.name)}`;
}

/** The run's work key: the automation's (rendered), else the default; always a valid key. */
export function renderWorkKey(automation: Automation, vars: TemplateVars): string {
  const rendered = automation.workKey ? renderTemplate(automation.workKey, vars).trim() : "";
  if (rendered && WorkKey.safeParse(rendered).success) return rendered;
  return defaultWorkKey(automation);
}

/** A short header so the agent knows the work is an automation run, not a person asking. */
export function runHeader(automation: Automation, runId: string, trigger: string): string {
  return [
    `This session was started by the CodeDen automation "${automation.name}" (${trigger}, run ${runId}).`,
    "Nobody is watching live: work autonomously, keep changes focused, and use report_progress, create_pull_request, attach_evidence and finish as described below. Follow the project's own conventions for issues and pull requests.",
  ].join(" ");
}
