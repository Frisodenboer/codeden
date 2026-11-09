import type {
  GitHubPrRef,
  GithubChecksSummary,
  GithubConnection,
  ReviewDecision,
} from "@codeden/contracts";
import { GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";
import {
  CHECK_STATES,
  checkState,
  checksBreakdown,
  summaryLabel,
  summaryState,
} from "@/lib/github-checks";
import { cn } from "@/lib/utils";
import { CheckGlyph, checkToneClass } from "./check-glyph";

/** Thin segmented bar of a PR's checks: passed, failed, running, queued, then the rest. */
function ChecksBar({ checks }: { checks: GithubChecksSummary }) {
  const b = checksBreakdown(checks.checks);
  const segments = [
    { n: b.passed, cls: "bg-status-done" },
    { n: b.failed, cls: "bg-status-failed" },
    { n: b.running, cls: "bg-status-running motion-safe:animate-pulse" },
    { n: b.queued, cls: "bg-status-waiting/60" },
    { n: b.other, cls: "bg-muted-foreground/35" },
  ].filter((s) => s.n > 0);
  return (
    <span className="flex h-1 w-10 gap-px overflow-hidden rounded-full" aria-hidden>
      {segments.map((s) => (
        <span
          key={s.cls}
          className={cn("h-full transition-[flex-grow] duration-500", s.cls)}
          style={{ flexGrow: s.n }}
        />
      ))}
    </span>
  );
}

/**
 * Combined checks state: a spinner while any check runs, a tick or cross once they finish,
 * optionally with `3/4` and a small progress bar while they're not all green.
 */
export function ChecksBadge({
  checks,
  withCount = true,
  className,
}: {
  checks: GithubChecksSummary;
  withCount?: boolean;
  className?: string;
}) {
  const state = summaryState(checks);
  const label = summaryLabel(checks);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-2xs tabular-nums", className)}
      title={label}
      data-checks={checks.state}
    >
      <CheckGlyph state={state} title={label} />
      {withCount && checks.total > 0 && (
        <>
          {checks.state !== "success" && checks.checks.length > 0 && <ChecksBar checks={checks} />}
          <span
            className={checks.state === "success" ? "text-status-done" : "text-muted-foreground"}
          >
            {checks.passed}/{checks.total}
          </span>
        </>
      )}
    </span>
  );
}

/** The icon for one check run or commit status. */
export function CheckIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  return <CheckGlyph state={checkState(status, conclusion)} />;
}

/** Short human label for one check ("Running", "Passed", "Timed out"), tinted by its state. */
export function CheckLabel({ status, conclusion }: { status: string; conclusion: string | null }) {
  const state = checkState(status, conclusion);
  const { label, tone } = CHECK_STATES[state];
  return (
    <span
      className={cn(
        "text-2xs whitespace-nowrap",
        tone === "running" || tone === "failed" ? checkToneClass(state) : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

const decisionText: Record<ReviewDecision, string> = {
  none: "",
  review_required: "Review required",
  approved: "Approved",
  changes_requested: "Changes requested",
};

export function ReviewDecisionBadge({ decision }: { decision: ReviewDecision }) {
  if (decision === "none") return null;
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-px text-3xs",
        decision === "approved" && "border-status-done/30 text-status-done",
        decision === "changes_requested" && "border-status-failed/30 text-status-failed",
        decision === "review_required" && "border-border text-muted-foreground",
      )}
    >
      {decisionText[decision]}
    </span>
  );
}

const stateTone: Record<GitHubPrRef["state"], string> = {
  draft: "border-border text-muted-foreground",
  open: "border-status-done/30 bg-status-done/10 text-status-done",
  merged: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  closed: "border-status-failed/30 bg-status-failed/10 text-status-failed",
};

export function PrStateBadge({ state }: { state: GitHubPrRef["state"] }) {
  return (
    <span className={cn("rounded-full border px-2 py-px text-3xs capitalize", stateTone[state])}>
      {state}
    </span>
  );
}

/** A GitHub label chip. */
export function LabelChip({ name }: { name: string }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-px text-3xs whitespace-nowrap text-muted-foreground">
      {name}
    </span>
  );
}

/** "Not connected" / "local-only" placeholder for GitHub views. */
export function GithubUnavailable({
  connection,
  localOnly,
  className,
  action,
}: {
  connection?: GithubConnection | null;
  localOnly?: boolean;
  className?: string;
  action?: ReactNode;
}) {
  const title = localOnly ? "Local-only project" : "GitHub is not connected";
  const body = localOnly
    ? "This project has no GitHub remote. Sessions, worktrees, diffs and automations work; issues, pull requests and evidence need a GitHub repository."
    : (connection?.message ?? "Run `gh auth login` in a terminal, then refresh.");
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center",
        className,
      )}
      data-testid="github-unavailable"
    >
      <GitPullRequest className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
