import type { GithubChecksSummary, GithubIssue, GithubPrDetails } from "@codeden/contracts";
import { ago } from "./helpers";

const SF = "https://github.com/hearth-co/storefront";

function checks(list: [string, "success" | "failure" | null][]): GithubChecksSummary {
  const failed = list.filter(([, c]) => c === "failure").length;
  const pending = list.filter(([, c]) => c === null).length;
  return {
    state: list.length === 0 ? "none" : failed ? "failure" : pending ? "pending" : "success",
    total: list.length,
    passed: list.length - failed - pending,
    failed,
    pending,
    checks: list.map(([name, conclusion]) => ({
      name,
      status: conclusion ? "completed" : "in_progress",
      conclusion,
      url: null,
    })),
  };
}

function issue(
  number: number,
  title: string,
  labels: string[],
  minutesAgo: number,
  sessionIds: string[] = [],
): GithubIssue {
  return {
    projectId: "p-storefront",
    number,
    title,
    state: "open",
    url: `${SF}/issues/${number}`,
    labels,
    author: "maya-k",
    body: null,
    comments: 2,
    createdAt: ago(minutesAgo),
    updatedAt: ago(minutesAgo / 2),
    closedAt: null,
    sessionIds,
  };
}

/** Storefront's open issues in the mock. */
export const mockIssues: GithubIssue[] = [
  issue(151, "Dark mode for the storefront", ["enhancement", "ui"], 300),
  issue(142, "Checkout e2e test is flaky on CI", ["bug", "tests", "ci"], 900, ["s-checkout"]),
  issue(139, "Product search with category and price filters", ["enhancement"], 2000, ["s-search"]),
  issue(131, "Image CDN returns 403 for webp", ["bug"], 4000),
];

function pr(
  number: number,
  title: string,
  state: "draft" | "open",
  sessionId: string,
  extra: Partial<GithubPrDetails>,
): GithubPrDetails {
  return {
    id: `p-storefront:${number}`,
    projectId: "p-storefront",
    number,
    title,
    state,
    url: `${SF}/pull/${number}`,
    author: "codeden-bot",
    headBranch: `codeden/${sessionId.slice(2)}`,
    baseBranch: "main",
    headSha: "4b1c9e2",
    checks: checks([]),
    reviewDecision: "review_required",
    reviews: [],
    mergeable: "mergeable",
    linkedIssues: [],
    commits: [],
    sessionId,
    createdAt: ago(120),
    updatedAt: ago(10),
    mergedAt: null,
    closedAt: null,
    body: "",
    additions: 0,
    deletions: 0,
    files: [],
    ...extra,
  };
}

/** Storefront's open PRs with live details. */
export const mockPrs: GithubPrDetails[] = [
  pr(58, "Accessibility fixes on the product page", "open", "s-a11y", {
    body: "Raises contrast to AA, restores focus rings and adds alt text to 14 images.",
    checks: checks([
      ["ci / typecheck", "success"],
      ["ci / unit", "success"],
      ["ci / e2e", "success"],
    ]),
    reviewDecision: "approved",
    reviews: [
      {
        id: "r1",
        author: "maya-k",
        state: "approved",
        body: "Looks great.",
        submittedAt: ago(30),
        url: null,
      },
    ],
    commits: [{ sha: "4b1c9e2", message: "fix(a11y): contrast, focus rings and alt text" }],
    additions: 18,
    deletions: 9,
    files: [
      { path: "src/pages/product.tsx", status: "modified", additions: 12, deletions: 6 },
      { path: "src/styles/tokens.css", status: "modified", additions: 6, deletions: 3 },
    ],
  }),
  pr(57, "Product search with filters", "draft", "s-search", {
    body: "Fixes #139.\n\n- Category chips and max-price filter\n- URL is the source of truth",
    checks: checks([
      ["ci / typecheck", "success"],
      ["ci / unit", "success"],
      ["ci / e2e", null],
    ]),
    linkedIssues: [139],
    additions: 61,
    deletions: 3,
    files: [{ path: "src/search/filters.tsx", status: "added", additions: 61, deletions: 3 }],
  }),
];
