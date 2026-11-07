import {
  type Automation,
  type AutomationRun,
  type GitHubIssueRef,
  type GithubIssue,
  type InboxItem,
  type Project,
  type StartedBy,
  StartSessionRequest,
  type StartSessionResponse,
  type TriageDecisionRequest,
  type TriageDecisionResponse,
  TriagePolicy,
  type TriageReport,
  type TriageReportResult,
} from "@codeden/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { githubIssues } from "../../db/schema";
import { badRequest, conflict } from "../errors";
import { rowToIssue } from "../github/rows";
import type { InboxService } from "../inbox-service";
import type { OrchestrationService } from "../orchestration/orchestration-service";
import type { ProjectService } from "../projects/project-service";
import type { SessionService } from "../sessions/session-service";

export interface TriageDeps {
  db: Db;
  inbox: InboxService;
  sessions: SessionService;
  projects: ProjectService;
  orchestration: () => OrchestrationService;
  /** The project's enabled triage automation, if any. */
  triageAutomation: (projectId: string) => Automation | undefined;
  /** A report arrived: complete the triage runs waiting on this issue. */
  reported?: (projectId: string, issueNumber: number, decision: string) => void;
}

/** Inbox id of the "Should I take this on?" decision for an issue. */
export function triageItemId(projectId: string, issueNumber: number): string {
  return `triage:${projectId}:${issueNumber}`;
}

function policyOf(automation: Automation | undefined): TriagePolicy {
  const raw = automation?.action.type === "triage" ? automation.action.policy : undefined;
  return TriagePolicy.parse(raw ?? {});
}

/**
 * Issue triage (§10). A triage run hands the new issue to the project's PM with the policy;
 * the PM classifies it with its GitHub tools (`get_issue`, `list_issues`, `triage_issue`) and
 * calls `report_triage`. A `ready` issue then starts a session when the policy allows it and
 * the project is not in manual mode, otherwise it becomes an inbox decision that the user
 * accepts (a session starts) or declines.
 */
export class TriageService {
  constructor(private readonly deps: TriageDeps) {}

  /** Send the triage request to the PM; returns the PM session id. */
  async request(
    project: Project,
    automation: Automation,
    run: AutomationRun,
    issue: GithubIssue | GitHubIssueRef,
  ): Promise<string> {
    if (project.kind !== "github") throw badRequest("Triage needs a GitHub project", "not_github");
    const policy = policyOf(automation);
    const labels = Object.entries(policy.labels)
      .map(([decision, names]) => `  - ${decision}: ${names.length ? names.join(", ") : "(none)"}`)
      .join("\n");
    const canStart = policy.autoStart && project.autonomyMode !== "manual";
    const text = [
      `Issue triage (automation "${automation.name}", run ${run.id}).`,
      `New issue #${issue.number}: ${issue.title ?? ""}`,
      issue.url,
      "",
      "1. Read it with get_issue (and list_issues to look for duplicates). Compare it with the project notes, the vision and the work already running.",
      "2. Classify it as exactly one of: ready (clear, in scope, safe to implement), needs_info (unclear or missing reproduction), unsafe (touches protected areas or needs a human decision), out_of_scope, duplicate.",
      `3. Apply it with triage_issue using these labels:\n${labels}`,
      policy.comment
        ? "   Include a short, friendly comment explaining the decision (for needs_info, ask the specific questions)."
        : "   Do not comment on the issue.",
      policy.closeRejected
        ? "   Close duplicates and out-of-scope issues (close: true)."
        : "   Do not close the issue.",
      "4. Then call report_triage with the issue number, the decision and a two-sentence summary.",
      canStart
        ? "   For ready issues CodeDen starts an agent session automatically; do not call start_session yourself."
        : "   For ready issues CodeDen asks the user whether to take it on; do not call start_session yourself.",
      automation.action.type === "triage" && automation.action.instructions
        ? `\nProject guidance:\n${automation.action.instructions}`
        : "",
    ]
      .filter((l) => l !== "")
      .join("\n");
    const res = await this.deps
      .orchestration()
      .sendToRole("pm", project.id, { text, attachments: [] });
    return res.sessionId;
  }

  /** The PM's `report_triage`. */
  async report(project: Project, report: TriageReport): Promise<TriageReportResult> {
    try {
      return await this.act(project, report);
    } finally {
      this.deps.reported?.(project.id, report.issueNumber, report.decision);
    }
  }

  private async act(project: Project, report: TriageReport): Promise<TriageReportResult> {
    if (report.decision !== "ready") return { status: "recorded" };
    const automation = this.deps.triageAutomation(project.id);
    const policy = policyOf(automation);
    const issue = this.issueRef(project, report.issueNumber);
    if (automation && policy.autoStart && project.autonomyMode !== "manual") {
      const start = await this.startForIssue(project, issue, report.summary, policy, {
        kind: "automation",
        id: automation.id,
      });
      return { status: "started", start };
    }
    const id = triageItemId(project.id, report.issueNumber);
    const existing = this.deps.inbox.find(id);
    if (existing?.status === "open") return { status: "inbox", inboxItemId: id };
    const now = new Date().toISOString();
    const item: InboxItem = {
      id,
      kind: "triage",
      status: "open",
      priority: "normal",
      title: `Should I take this on? #${issue.number} ${issue.title ?? ""}`.trim(),
      body: report.summary,
      projectId: project.id,
      sessionId: null,
      threadId: null,
      itemId: null,
      requestId: null,
      issue,
      pr: null,
      automationRunId: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      resolution: null,
    };
    this.deps.inbox.put(item);
    return { status: "inbox", inboxItemId: id };
  }

  /** Accept a triage decision: start a session for the issue and close the item. */
  async accept(itemId: string, req: TriageDecisionRequest): Promise<TriageDecisionResponse> {
    const item = this.openItem(itemId);
    const project = this.deps.projects.get(item.projectId ?? "");
    if (!item.issue) throw badRequest("The decision has no issue", "no_issue");
    const policy = policyOf(this.deps.triageAutomation(project.id));
    const start = await this.startForIssue(
      project,
      item.issue,
      item.body ?? "",
      { ...policy, provider: req.provider ?? policy.provider, model: req.model ?? policy.model },
      { kind: "user" },
      req.conflict,
    );
    if (start.status === "conflict") return { item, start };
    const closed = this.deps.inbox.close(item, "resolved", {
      decision: "accept",
      start: JSON.parse(JSON.stringify(start)),
    });
    return { item: closed, start };
  }

  /** Decline: close the item; the issue keeps its triage labels. */
  decline(itemId: string, req: TriageDecisionRequest): TriageDecisionResponse {
    const item = this.openItem(itemId);
    const closed = this.deps.inbox.close(item, "dismissed", {
      decision: "decline",
      ...(req.reason ? { reason: req.reason } : {}),
    });
    return { item: closed, start: null };
  }

  private openItem(itemId: string): InboxItem {
    const item = this.deps.inbox.get(itemId);
    if (item.kind !== "triage") throw badRequest("Not a triage decision", "not_triage");
    if (item.status !== "open") throw conflict("The decision was already made", "resolved");
    return item;
  }

  private async startForIssue(
    project: Project,
    issue: GitHubIssueRef,
    summary: string,
    policy: TriagePolicy,
    startedBy: StartedBy,
    decision?: TriageDecisionRequest["conflict"],
  ): Promise<StartSessionResponse> {
    const title = issue.title ?? `Issue #${issue.number}`;
    const prompt = [
      `Resolve GitHub issue #${issue.number}: ${title}`,
      issue.url,
      summary ? `\nTriage summary: ${summary}` : "",
      "",
      `Read the full issue and its comments first (\`gh issue view ${issue.number} --comments\`). Implement the change in your worktree following the project's conventions, add or update tests that prove it, and run the test suite.`,
      `Then open a pull request with create_pull_request whose body includes "Fixes #${issue.number}", attach evidence (test output, and screenshots for UI changes) with attach_evidence, and call finish. If the issue turns out to be unclear or unsafe, ask with ask_user instead of guessing.`,
    ]
      .filter((l) => l !== "")
      .join("\n");
    return this.deps.sessions.start(
      StartSessionRequest.parse({
        projectId: project.id,
        role: "agent",
        provider: policy.provider,
        model: policy.model,
        autonomy: policy.autonomy,
        purpose: `Resolve #${issue.number}: ${title}`.slice(0, 300),
        workKey: `issue:${issue.number}`,
        startedBy,
        title: `#${issue.number} ${title}`.slice(0, 200),
        issue,
        input: { text: prompt, attachments: [] },
        conflict: decision,
      }),
    );
  }

  /** The synced issue when known, else a link built from the repository. */
  private issueRef(project: Project, number: number): GitHubIssueRef {
    const row = this.deps.db
      .select()
      .from(githubIssues)
      .where(and(eq(githubIssues.projectId, project.id), eq(githubIssues.number, number)))
      .get();
    if (row) {
      const issue = rowToIssue(row);
      return { number, url: issue.url, title: issue.title };
    }
    if (project.kind !== "github") throw badRequest("Triage needs a GitHub project", "not_github");
    return {
      number,
      url: `https://github.com/${project.github.owner}/${project.github.repo}/issues/${number}`,
    };
  }
}
