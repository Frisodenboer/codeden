import {
  type CreateGithubIssueRequest,
  type GitHubRepo,
  GithubIssue,
  type GithubIssueComment,
  type GithubIssueDetails,
  type GithubLabelRequest,
  type TriageIssueRequest,
  type TriageIssueResult,
} from "@codeden/contracts";
import type { EventStore } from "../../events/store";
import type { GithubClient } from "./client";
import { diffIssue, type RestIssue, toGithubIssue } from "./diff";
import type { GithubStore } from "./store";

export interface IssueDeps {
  client: GithubClient;
  store: GithubStore;
  events: EventStore;
}

/** Project a REST issue we just read or changed (appends `issue.*` when it differs). */
function project(deps: IssueDeps, projectId: string, raw: RestIssue): GithubIssue {
  const next = GithubIssue.parse(toGithubIssue(projectId, raw));
  const events = diffIssue(deps.store.issue(projectId, raw.number), next);
  if (events.length > 0) deps.events.append(events);
  return deps.store.issue(projectId, raw.number) ?? next;
}

async function readIssue(deps: IssueDeps, repo: GitHubRepo, number: number): Promise<RestIssue> {
  return deps.client.run(async (octokit) => {
    const res = await octokit.rest.issues.get({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: number,
    });
    return res.data as RestIssue;
  });
}

/** An issue fresh from GitHub with its latest comments. */
export async function getIssueDetails(
  deps: IssueDeps,
  projectId: string,
  repo: GitHubRepo,
  number: number,
): Promise<GithubIssueDetails> {
  const raw = await readIssue(deps, repo, number);
  const issue = project(deps, projectId, raw);
  const comments = await deps.client.run(async (octokit) => {
    const res = await octokit.rest.issues.listComments({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: number,
      per_page: 100,
    });
    return res.data.slice(-20);
  });
  const recentComments: GithubIssueComment[] = comments.map((c) => ({
    id: c.id,
    author: c.user?.login ?? null,
    body: c.body ?? "",
    createdAt: c.created_at,
    url: c.html_url,
  }));
  return { ...issue, recentComments };
}

export async function createIssue(
  deps: IssueDeps,
  projectId: string,
  repo: GitHubRepo,
  req: CreateGithubIssueRequest,
): Promise<GithubIssue> {
  const raw = await deps.client.run(async (octokit) => {
    const res = await octokit.rest.issues.create({
      owner: repo.owner,
      repo: repo.repo,
      title: req.title,
      body: req.body,
      labels: req.labels,
    });
    return res.data as RestIssue;
  });
  return project(deps, projectId, raw);
}

/** Comment on an issue or a PR conversation (PRs are issues for comments). */
export async function commentOnIssue(
  deps: Pick<IssueDeps, "client">,
  repo: GitHubRepo,
  number: number,
  body: string,
): Promise<{ id: number; url: string }> {
  return deps.client.run(async (octokit) => {
    const res = await octokit.rest.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: number,
      body,
    });
    return { id: res.data.id, url: res.data.html_url };
  });
}

export async function labelIssue(
  deps: IssueDeps,
  projectId: string,
  repo: GitHubRepo,
  number: number,
  req: GithubLabelRequest,
): Promise<GithubIssue> {
  await deps.client.run(async (octokit) => {
    if (req.add.length > 0) {
      await octokit.rest.issues.addLabels({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: number,
        labels: req.add,
      });
    }
    for (const name of req.remove) {
      try {
        await octokit.rest.issues.removeLabel({
          owner: repo.owner,
          repo: repo.repo,
          issue_number: number,
          name,
        });
      } catch (error) {
        // Removing a label the issue doesn't have is not an error for us.
        if ((error as { status?: number }).status !== 404) throw error;
      }
    }
  });
  return project(deps, projectId, await readIssue(deps, repo, number));
}

/** Apply a triage decision (§10): labels, comment, and optionally close. */
export async function triageIssue(
  deps: IssueDeps,
  projectId: string,
  repo: GitHubRepo,
  number: number,
  req: TriageIssueRequest,
): Promise<TriageIssueResult> {
  if (req.labels.length > 0 || req.removeLabels.length > 0) {
    await labelIssue(deps, projectId, repo, number, { add: req.labels, remove: req.removeLabels });
  }
  const comment = req.comment ? await commentOnIssue(deps, repo, number, req.comment) : null;
  if (req.close) {
    await deps.client.run((octokit) =>
      octokit.rest.issues.update({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: number,
        state: "closed",
        state_reason: req.decision === "ready" ? "completed" : "not_planned",
      }),
    );
  }
  const issue = project(deps, projectId, await readIssue(deps, repo, number));
  return {
    issue,
    decision: req.decision,
    commentUrl: comment?.url ?? null,
    closed: issue.state === "closed",
  };
}
