import type {
  GithubIssue,
  GithubIssueDetails,
  Project,
  ScheduledRun,
  TriageIssueRequest,
  TriageIssueResult,
} from "@codeden/contracts";
import type { z } from "zod";
import { ServiceError } from "../errors";

/**
 * Seams the orchestration tools call for work owned elsewhere: GitHub issues (backed by
 * `GithubService` through `GithubServicePort`) and automations (schedules, runs). The stubs
 * keep the PM tools honest where no implementation is wired into `createServices`.
 */

/** Issue triage input (the PM's `triage_issue`); defaults are applied by the contract. */
export type TriageRequest = z.input<typeof TriageIssueRequest>;

/** GitHub issue operations the PM tools need. Only called for `github` projects. */
export interface GithubPort {
  listIssues(
    project: Project,
    query: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number },
  ): Promise<GithubIssue[]>;
  getIssue(project: Project, number: number): Promise<GithubIssueDetails>;
  triageIssue(project: Project, number: number, triage: TriageRequest): Promise<TriageIssueResult>;
  createIssue(
    project: Project,
    issue: { title: string; body: string; labels?: string[] },
  ): Promise<GithubIssue>;
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
  async listIssues(): Promise<GithubIssue[]> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async getIssue(): Promise<GithubIssueDetails> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async triageIssue(): Promise<TriageIssueResult> {
    throw unavailable("GitHub sync", "github_unavailable");
  }
  async createIssue(): Promise<GithubIssue> {
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
