import type { FactoryMergeChecks, FactoryWorkItem, MergeCheck } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock, GitMerge, Loader2, Minus, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHECK_HELP, CHECK_LABEL, STAGE_LABEL } from "./meta";

function Column({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-2xs font-medium text-muted-foreground">
        {title} <span className="ml-auto tabular-nums">{count}</span>
      </div>
      <div className="space-y-0.5 p-1.5">
        {count === 0 ? (
          <p className="px-2 py-3 text-center text-3xs text-muted-foreground/70">Nothing yet</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

const rowCls =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-accent/60";

function ItemLink({
  projectId,
  item,
  children,
}: {
  projectId: string;
  item: { id: string };
  children: ReactNode;
}) {
  return (
    <Link
      to="/projects/$projectId/factory/$itemId"
      params={{ projectId, itemId: item.id }}
      className={rowCls}
      data-testid="factory-item-link"
    >
      {children}
    </Link>
  );
}

export function BacklogColumn({
  projectId,
  backlog,
  inProgress,
}: {
  projectId: string;
  backlog: FactoryWorkItem[];
  inProgress: FactoryWorkItem[];
}) {
  return (
    <Column title="In progress · backlog" count={inProgress.length + backlog.length}>
      {inProgress.map((w) => (
        <ItemLink key={w.id} projectId={projectId} item={w}>
          <Loader2
            className={cn(
              "size-3 shrink-0 animate-spin",
              w.stage === "verifying" ? "text-status-waiting" : "text-status-running",
            )}
          />
          <span className="truncate" title={w.note ?? undefined}>
            {w.title}
          </span>
          <span className="ml-auto shrink-0 text-3xs text-muted-foreground">
            {STAGE_LABEL[w.stage].label}
          </span>
        </ItemLink>
      ))}
      {inProgress.length > 0 && backlog.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
      {backlog.map((w) => (
        <ItemLink key={w.id} projectId={projectId} item={w}>
          <span
            className="flex h-3 w-7 shrink-0 overflow-hidden rounded-full bg-muted"
            title={w.score === null ? "Not scored yet" : `Vision score ${w.score.toFixed(2)}`}
          >
            <span className="bg-primary/70" style={{ width: `${(w.score ?? 0) * 100}%` }} />
          </span>
          <span className="truncate text-muted-foreground">{w.title}</span>
          {w.issue && (
            <span className="ml-auto shrink-0 font-mono text-3xs text-muted-foreground">
              #{w.issue.number}
            </span>
          )}
        </ItemLink>
      ))}
    </Column>
  );
}

const checkStyle = {
  pass: { icon: Check, cls: "border-status-done/30 bg-status-done/10 text-status-done" },
  fail: { icon: X, cls: "border-status-failed/30 bg-status-failed/10 text-status-failed" },
  pending: { icon: Clock, cls: "border-border text-muted-foreground" },
  skipped: { icon: Minus, cls: "border-border text-muted-foreground/60" },
};

/** One merge-check result as a small pill (detail in the tooltip). */
export function CheckPill({ check }: { check: MergeCheck }) {
  const s = checkStyle[check.state];
  return (
    <span
      title={check.detail ?? CHECK_HELP[check.name]}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-3xs",
        s.cls,
        check.escalate && "border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
      )}
      data-check={check.name}
      data-state={check.state}
    >
      {check.escalate ? <AlertTriangle className="size-2.5" /> : <s.icon className="size-2.5" />}
      {CHECK_LABEL[check.name]}
    </span>
  );
}

export function ChecksColumn({
  projectId,
  checks,
}: {
  projectId: string;
  checks: FactoryMergeChecks[];
}) {
  return (
    <Column title="Merge checks" count={checks.length}>
      {checks.map((pr) => (
        <Link
          key={pr.itemId}
          to="/projects/$projectId/factory/$itemId"
          params={{ projectId, itemId: pr.itemId }}
          className="block rounded-md px-2 py-1.5 hover:bg-accent/60"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px]">
            <span className="font-mono text-3xs text-muted-foreground">#{pr.prNumber}</span>
            <span className="truncate">{pr.title}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {pr.checks.map((c) => (
              <CheckPill key={c.name} check={c} />
            ))}
          </div>
          {pr.reviewerProvider && (
            <p className="mt-1 text-3xs text-muted-foreground/80">
              Reviewer: {pr.reviewerProvider}
              {pr.verdict && ` · ${pr.verdict.replace("_", " ")}`}
              {pr.reviewerNote && ` · ${pr.reviewerNote}`}
            </p>
          )}
        </Link>
      ))}
    </Column>
  );
}

const recentIcon = {
  merged: { icon: GitMerge, cls: "text-chart-4" },
  reverted: { icon: Undo2, cls: "text-status-failed" },
  failed: { icon: X, cls: "text-status-failed" },
  rejected: { icon: X, cls: "text-muted-foreground" },
  escalated: { icon: AlertTriangle, cls: "text-status-waiting" },
};

export function RecentColumn({
  projectId,
  recent,
}: {
  projectId: string;
  recent: FactoryWorkItem[];
}) {
  return (
    <Column title="Recent merges & reverts" count={recent.length}>
      {recent.map((w) => {
        const s = recentIcon[w.stage as keyof typeof recentIcon] ?? recentIcon.merged;
        return (
          <ItemLink key={w.id} projectId={projectId} item={w}>
            <s.icon className={cn("size-3.5 shrink-0", s.cls)} />
            <span
              className={cn("truncate", w.stage === "rejected" && "text-muted-foreground")}
              title={w.reason ?? undefined}
            >
              {w.title}
            </span>
            <span className={cn("ml-auto shrink-0 text-3xs", s.cls)}>
              {STAGE_LABEL[w.stage].label.toLowerCase()} · {ago(w.updatedAt)}
            </span>
          </ItemLink>
        );
      })}
    </Column>
  );
}
