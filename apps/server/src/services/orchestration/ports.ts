import type { Project, ScheduledRun } from "@codeden/contracts";
import { ServiceError } from "../errors";

/**
 * Seams the orchestration tools call for work owned elsewhere: GitHub (issues, PRs) and
 * automations (schedules, runs). The stubs here keep the PM tools honest until the real
 * implementations are wired into `createServices` (`githubPort`, `automationPort`).
 */

export interface GithubIssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  url: string;
  author?: string;
  updatedAt?: string;
}

export interface GithubIssueDetail extends GithubIssueSummary {
  body: string;
  comments: { author: string; body: string; createdAt: string }[];
}

/** Triage decision for an issue (§10 issue triage). */
export type TriageDecision = "ready" | "needs_info" | "unsafe" | "out_of_scope" | "duplicate";

export interface TriageRequest {
  decision: TriageDecision;
  labels?: string[];
  comment?: string;
  /** Close the issue (out of scope, duplicate). */
  close?: boolean;
}

export interface GithubPrStatus {
  number: number;
  title: string;
  url: string;
  state: "draft" | "open" | "closed" | "merged";
  mergeable: boolean | null;
  checks: { name: string; state: "pending" | "pass" | "fail" }[];
  reviews: { author: string; state: "approved" | "changes_requested" | "commented" }[];
}

/** GitHub operations the PM tools need. Only called for `github` projects. */
export interface GithubPort {
  listIssues(
    project: Project,
    query: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number },
  ): Promise<GithubIssueSummary[]>;
  getIssue(project: Project, number: number): Promise<GithubIssueDetail>;
  triageIssue(project: Project, number: number, triage: TriageRequest): Promise<GithubIssueSummary>;
  createIssue(
    project: Project,
    issue: { title: string; body: string; labels?: string[] },
  ): Promise<GithubIssueSummary>;
  getPrStatus(project: Project, number: number): Promise<GithubPrStatus>;
}

/** Automation scheduling the PM tools and the status digest need (§8.4, §10). */
export interface AutomationPort {
  /** Upcoming runs, soonest first (synchronous: used by every digest). */
  listScheduledRuns(projectId: string | null, limit?: number): ScheduledRun[];
  /** Skip the next occurrence; returns it, or null when nothing is scheduled. */
  skipNextRun(automationId: string, projectId: string): Promise<ScheduledRun | null>;
  pause(automationId: string, projectId: string): Promise<void>;
  resume(automationId: string, projectId: string): Promise<void>;
  cancelQueuedRun(runId: string, projectId: string): Promise<void>;
}

const unavailable = (what: string, code: string) =>
  new ServiceError(503, code, `${what} is not available in this CodeDen build yet.`);

/** GitHub stub: every call fails with `github_unavailable`. */
export class UnavailableGithubPort implements GithubPort {
  async listIssues(): Promise<GithubIssueSummary[]> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async getIssue(): Promise<GithubIssueDetail> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async triageIssue(): Promise<GithubIssueSummary> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async createIssue(): Promise<GithubIssueSummary> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async getPrStatus(): Promise<GithubPrStatus> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
}

/** Automation stub: nothing is scheduled, and schedule changes fail with `automations_unavailable`. */
export class UnavailableAutomationPort implements AutomationPort {
  listScheduledRuns(): ScheduledRun[] {
    return [];
  }
  async skipNextRun(): Promise<ScheduledRun | null> {
    throw unavailable("Automation scheduling", "automations_unavailable");
  }
  async pause(): Promise<void> {
    throw unavailable("Automation scheduling", "automations_unavailable");
  }
  async resume(): Promise<void> {
    throw unavailable("Automation scheduling", "automations_unavailable");
  }
  async cancelQueuedRun(): Promise<void> {
    throw unavailable("Automation scheduling", "automations_unavailable");
  }
}
