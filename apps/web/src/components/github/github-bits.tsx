import type {
  GitHubPrRef,
  GithubChecksSummary,
  GithubConnection,
  ReviewDecision,
} from "@codeden/contracts";
import { CheckCircle2, Circle, Clock, GitPullRequest, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const checksTone = {
  none: "text-muted-foreground/60",
  pending: "text-status-waiting",
  success: "text-status-done",
  failure: "text-status-failed",
};
const checksIcon = { none: Circle, pending: Clock, success: CheckCircle2, failure: XCircle };

/** Combined checks state: an icon, optionally with `3/4`. */
export function ChecksBadge({
  checks,
  withCount = true,
  className,
}: {
  checks: GithubChecksSummary;
  withCount?: boolean;
  className?: string;
}) {
  const Icon = checksIcon[checks.state];
  const label =
    checks.state === "none"
      ? "No checks"
      : `${checks.passed}/${checks.total} checks passed${checks.failed ? `, ${checks.failed} failed` : ""}`;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-2xs tabular-nums", className)}
      title={label}
      data-checks={checks.state}
    >
      <Icon className={cn("size-3.5", checksTone[checks.state])} />
      {withCount && checks.total > 0 && (
        <span className="text-muted-foreground">
          {checks.passed}/{checks.total}
        </span>
      )}
    </span>
  );
}

/** Tone of one check run from its status and conclusion. */
export function checkTone(status: string, conclusion: string | null): keyof typeof checksTone {
  if (status !== "completed") return "pending";
  if (conclusion === "success") return "success";
  if (conclusion === "neutral" || conclusion === "skipped") return "none";
  return "failure";
}

export function CheckIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  const tone = checkTone(status, conclusion);
  const Icon = checksIcon[tone];
  return <Icon className={cn("size-3.5 shrink-0", checksTone[tone])} />;
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
