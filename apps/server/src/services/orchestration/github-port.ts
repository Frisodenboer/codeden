import {
  CreateGithubIssueRequest,
  type GithubIssue,
  type GithubIssueDetails,
  type Project,
  TriageIssueRequest,
  type TriageIssueResult,
} from "@codeden/contracts";
import type { GithubService } from "../github/github-service";
import type { GithubPort, TriageRequest } from "./ports";

/** The orchestration `GithubPort` over the real `GithubService` (§8.3 PM issue tools, §9). */
export class GithubServicePort implements GithubPort {
  constructor(private readonly github: GithubService) {}

  listIssues(
    project: Project,
    query: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number },
  ): Promise<GithubIssue[]> {
    return this.github.listIssues(project.id, query);
  }

  getIssue(project: Project, number: number): Promise<GithubIssueDetails> {
    return this.github.getIssue(project.id, number);
  }

  triageIssue(project: Project, number: number, triage: TriageRequest): Promise<TriageIssueResult> {
    return this.github.triageIssue(project.id, number, TriageIssueRequest.parse(triage));
  }

  createIssue(
    project: Project,
    issue: { title: string; body: string; labels?: string[] },
  ): Promise<GithubIssue> {
    return this.github.createIssue(project.id, CreateGithubIssueRequest.parse(issue));
  }
}
