import type {
  FactoryLimits,
  FactoryTuning,
  MergeCheck,
  MergeCheckName,
  MergeCheckState,
  ProtectedAreas,
  ReviewVerdict,
} from "@codeden/contracts";
import type { FactoryPr } from "./github-port";
import { isNonCodeFile, isTestFile, isUiFile, protectedHits } from "./policy";
import { changeSize, overSizeLimit, sizeLimitText } from "./size";

/** Everything the merge checks look at for one pull request. */
export interface CheckInputs {
  pr: FactoryPr;
  issueTitle: string | null;
  review: ReviewVerdict | null;
  /** Provider of the reviewer, for the pending message. */
  reviewer: string | null;
  /** Screenshots attached; null when not looked up (no UI files). */
  evidence: boolean | null;
  /** Result of the configured audit command; null while not run (or not configured). */
  audit: { ok: boolean; detail: string } | null;
  auditConfigured: boolean;
  /** True once CI had time to register; before that "no checks" counts as pending. */
  ciGraceOver: boolean;
  limits: FactoryLimits;
  tuning: FactoryTuning;
  /** Why the PM let this item go over the size limit; null when it didn't. */
  largeChange: string | null;
  areas: ProtectedAreas;
  now: string;
}

/** Overall result: merge, wait, fix (or fail), or hand to a human. */
export type ChecksOutcome = "pass" | "pending" | "fail" | "escalate";

const ORDER: MergeCheckName[] = [
  "protected_paths",
  "size",
  "ci",
  "review",
  "tests",
  "security",
  "ui_evidence",
];

function list(items: string[], max = 5): string {
  return items.length > max
    ? `${items.slice(0, max).join(", ")} and ${items.length - max} more`
    : items.join(", ");
}

/**
 * Evaluate the merge checks (§10.1 step 4). Pure: the caller gathers the inputs (PR details,
 * the reviewer's verdict, evidence, audit) and records the result on the item.
 */
export function evaluateChecks(i: CheckInputs): { checks: MergeCheck[]; outcome: ChecksOutcome } {
  const out = new Map<MergeCheckName, MergeCheck>();
  const set = (
    name: MergeCheckName,
    state: MergeCheckState,
    detail: string | null,
    escalate = false,
  ) => out.set(name, { name, state, detail, escalate, at: i.now });
  const files = i.pr.files;

  const hits = protectedHits({
    files,
    text: [i.pr.title, i.pr.body, i.issueTitle ?? ""].join("\n"),
    limits: i.limits,
    areas: i.areas,
  });
  if (hits.paths.length > 0 || hits.topics.length > 0) {
    const parts = [
      hits.paths.length ? `paths: ${list(hits.paths.map((h) => h.path))}` : "",
      hits.topics.length ? `topics: ${hits.topics.join(", ")}` : "",
    ].filter(Boolean);
    set("protected_paths", "fail", `Touches protected areas (${parts.join("; ")})`, true);
  } else set("protected_paths", "pass", null);

  const size = changeSize(i.pr);
  const measured = `${size.lines.toLocaleString("en")} lines in ${size.files} files${size.uncounted ? ` (${size.uncounted} lockfiles or generated files not counted)` : ""}`;
  if (!overSizeLimit(size, i.tuning)) set("size", "pass", measured);
  else if (i.largeChange) set("size", "pass", `${measured}; allowed by the PM: ${i.largeChange}`);
  else set("size", "fail", `${measured}, over the limit of ${sizeLimitText(i.tuning)}`);

  switch (i.pr.checks) {
    case "success":
      set("ci", "pass", null);
      break;
    case "failure":
      set("ci", "fail", `CI failed: ${list(i.pr.failedChecks) || "see the PR"}`);
      break;
    case "pending":
      set("ci", "pending", "CI is running");
      break;
    case "none":
      if (!i.tuning.requireCi) set("ci", "skipped", "No CI configured (not required)");
      else if (!i.ciGraceOver) set("ci", "pending", "Waiting for CI to report");
      else
        set("ci", "fail", "No CI reported on the head commit; CI is required for automatic merges");
      break;
  }

  if (!i.review)
    set("review", "pending", `Waiting for the review${i.reviewer ? ` (${i.reviewer})` : ""}`);
  else if (i.review.verdict === "approve") set("review", "pass", i.review.summary);
  else set("review", "fail", `${i.review.verdict}: ${i.review.summary}`);

  const code = files.filter((f) => !isTestFile(f) && !isNonCodeFile(f));
  const tests = files.filter(isTestFile);
  if (code.length === 0) set("tests", "pass", "No code changed");
  else if (!i.review)
    set(
      "tests",
      "pending",
      tests.length
        ? `${tests.length} test files changed`
        : "No test files changed; waiting for the reviewer",
    );
  else if (!i.review.tests.adequate)
    set(
      "tests",
      "fail",
      `Reviewer: tests are not adequate${i.review.tests.note ? ` (${i.review.tests.note})` : ""}`,
    );
  else if (tests.length === 0 && !i.review.tests.notNeeded)
    set("tests", "fail", "Code changed but no test files were added or updated");
  else
    set(
      "tests",
      "pass",
      tests.length ? `${tests.length} test files changed` : "Reviewer: no tests needed",
    );

  const concerns = i.review?.security.concerns ?? [];
  if (i.auditConfigured && i.audit && !i.audit.ok)
    set("security", "fail", `Audit failed: ${i.audit.detail}`);
  else if (concerns.length > 0) set("security", "fail", `Reviewer: ${concerns.join("; ")}`);
  else if ((i.auditConfigured && !i.audit) || !i.review)
    set(
      "security",
      "pending",
      i.auditConfigured && !i.audit
        ? "Audit not run yet"
        : "Waiting for the reviewer's security pass",
    );
  else
    set(
      "security",
      "pass",
      i.auditConfigured
        ? `Audit clean; ${i.audit?.detail ?? ""}`.trim()
        : "Reviewer found no security concerns",
    );

  const ui = files.filter(isUiFile);
  if (ui.length === 0) set("ui_evidence", "skipped", "No UI files changed");
  else if (i.evidence === true) set("ui_evidence", "pass", "Screenshots attached");
  else if (i.evidence === null) set("ui_evidence", "pending", "Checking for screenshots");
  else
    set(
      "ui_evidence",
      "fail",
      `UI files changed (${list(ui)}) but no screenshots were attached with attach_evidence`,
    );

  const checks = ORDER.flatMap((n) => {
    const c = out.get(n);
    return c ? [c] : [];
  });
  const outcome: ChecksOutcome = checks.some((c) => c.escalate)
    ? "escalate"
    : checks.some((c) => c.state === "fail")
      ? "fail"
      : checks.some((c) => c.state === "pending")
        ? "pending"
        : "pass";
  return { checks, outcome };
}

/** Checks that failed (for fix prompts and reasons). */
export function failedChecks(checks: MergeCheck[]): MergeCheck[] {
  return checks.filter((c) => c.state === "fail");
}

/** True when two check lists say the same (ignoring timestamps). */
export function sameChecks(a: MergeCheck[], b: MergeCheck[]): boolean {
  const strip = (l: MergeCheck[]) => JSON.stringify(l.map(({ at: _at, ...rest }) => rest));
  return strip(a) === strip(b);
}
