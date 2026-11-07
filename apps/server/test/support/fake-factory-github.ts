import type { ChecksState, GitHubIssueRef, GitHubPrRef, GithubIssue } from "@codeden/contracts";
import type {
  CommitChecks,
  FactoryGithub,
  FactoryPr,
} from "../../src/services/factory/github-port";

/** A pull request in the scripted GitHub. */
export interface FakePr extends FactoryPr {
  sessionId: string | null;
  evidence: boolean;
}

/**
 * A scripted GitHub for the factory loop: issues, PRs (linked to sessions), CI states, merges,
 * comments and reverts, all in memory. Tests change `prs`/`commitState` to steer the loop.
 */
export class FakeFactoryGithub implements FactoryGithub {
  issues: GithubIssue[] = [];
  prs = new Map<number, FakePr>();
  comments: Array<{ number: number; body: string }> = [];
  merges: Array<{ number: number; sha: string | null; title: string }> = [];
  reverts: Array<{ sha: string; prNumber: number }> = [];
  /** CI state per commit sha (default success). */
  commitState = new Map<string, CommitChecks>();
  main = { sha: "main0000000", checks: "success" as ChecksState, failed: [] as string[] };
  githubProjects = new Set<string>();
  /** When false, `revertMerge` returns null (main moved on). */
  canRevertViaApi = true;
  private next = 100;

  isGithubProject(projectId: string): boolean {
    return this.githubProjects.has(projectId);
  }

  async createIssue(
    projectId: string,
    req: { title: string; body: string; labels: string[] },
  ): Promise<GitHubIssueRef> {
    const number = this.next++;
    const url = `https://github.com/acme/app/issues/${number}`;
    const now = new Date().toISOString();
    this.issues.push({
      projectId,
      number,
      title: req.title,
      state: "open",
      url,
      labels: req.labels,
      author: "codeden",
      body: req.body,
      comments: 0,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      sessionIds: [],
    });
    return { number, url, title: req.title };
  }

  async labelIssue(_projectId: string, number: number, labels: string[]): Promise<void> {
    const issue = this.issues.find((i) => i.number === number);
    if (issue) issue.labels = [...new Set([...issue.labels, ...labels])];
  }

  async comment(_projectId: string, number: number, body: string): Promise<void> {
    this.comments.push({ number, body });
  }

  openIssues(projectId: string): GithubIssue[] {
    return this.issues.filter((i) => i.projectId === projectId && i.state === "open");
  }

  /** Open a PR for a session (what `create_pull_request` would do). */
  openPr(opts: {
    sessionId: string | null;
    title: string;
    files: string[];
    additions?: number;
    deletions?: number;
    checks?: ChecksState;
    evidence?: boolean;
  }): FakePr {
    const number = this.next++;
    const ref: GitHubPrRef = {
      number,
      url: `https://github.com/acme/app/pull/${number}`,
      state: "open",
      title: opts.title,
    };
    const pr: FakePr = {
      ref,
      title: opts.title,
      body: `Fixes the issue`,
      headSha: `head${number}`,
      headBranch: `codeden/pr-${number}`,
      checks: opts.checks ?? "success",
      failedChecks: opts.checks === "failure" ? ["test"] : [],
      additions: opts.additions ?? 20,
      deletions: opts.deletions ?? 2,
      files: opts.files,
      sessionId: opts.sessionId,
      evidence: opts.evidence ?? false,
    };
    this.prs.set(number, pr);
    return pr;
  }

  prForSession(_projectId: string, sessionId: string): GitHubPrRef | null {
    return [...this.prs.values()].find((p) => p.sessionId === sessionId)?.ref ?? null;
  }

  async prDetails(_projectId: string, number: number): Promise<FactoryPr> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    return { ...pr, ref: { ...pr.ref }, files: [...pr.files] };
  }

  async hasScreenshotEvidence(_projectId: string, prNumber: number): Promise<boolean> {
    return this.prs.get(prNumber)?.evidence ?? false;
  }

  async merge(_projectId: string, number: number, opts: { sha: string | null; title: string }) {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`no PR ${number}`);
    pr.ref = { ...pr.ref, state: "merged" };
    const sha = `merge${number}`;
    this.merges.push({ number, sha, title: opts.title });
    this.main.sha = sha;
    return { merged: true, sha };
  }

  async commitChecks(_projectId: string, sha: string): Promise<CommitChecks> {
    return this.commitState.get(sha) ?? "success";
  }

  async mainHead() {
    return { ...this.main };
  }

  async revertMerge(_projectId: string, merge: { sha: string; prNumber: number; title: string }) {
    if (!this.canRevertViaApi) return null;
    this.reverts.push({ sha: merge.sha, prNumber: merge.prNumber });
    const pr = this.openPr({
      sessionId: null,
      title: `Revert "${merge.title}"`,
      files: ["src/app.ts", "test/app.test.ts"],
    });
    return pr.ref;
  }
}
