import { Link } from "@tanstack/react-router";
import { Check, Clock, GitMerge, Loader2, Minus, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { FactoryWorkItem, MergeCheckName, MergeCheckResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";

function Column({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-2xs font-medium text-muted-foreground">
        {title} <span className="ml-auto tabular-nums">{count}</span>
      </div>
      <div className="space-y-0.5 p-1.5">{children}</div>
    </div>
  );
}

export function BacklogColumn({
  backlog,
  inProgress,
}: {
  backlog: FactoryWorkItem[];
  inProgress: FactoryWorkItem[];
}) {
  return (
    <Column title="In progress · backlog" count={inProgress.length + backlog.length}>
      {inProgress.map((w) => (
        <Link
          key={w.id}
          to="/sessions/$sessionId"
          params={{ sessionId: w.sessionId ?? "" }}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-accent/60"
        >
          <Loader2
            className={cn(
              "size-3 shrink-0 animate-spin",
              w.stage === "verifying" ? "text-status-waiting" : "text-status-running",
            )}
          />
          <span className="truncate">{w.title}</span>
          <span className="ml-auto shrink-0 text-3xs text-muted-foreground capitalize">
            {w.stage}
          </span>
        </Link>
      ))}
      {inProgress.length > 0 && backlog.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
      {backlog.map((w) => (
        <div
          key={w.id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground"
        >
          <span
            className="flex h-3 w-7 shrink-0 overflow-hidden rounded-full bg-muted"
            title={`Vision score ${w.score}`}
          >
            <span className="bg-primary/70" style={{ width: `${(w.score ?? 0) * 100}%` }} />
          </span>
          <span className="truncate">{w.title}</span>
          {w.issue && (
            <span className="ml-auto shrink-0 font-mono text-3xs">#{w.issue.number}</span>
          )}
        </div>
      ))}
    </Column>
  );
}

const checkLabel: Record<MergeCheckName, string> = {
  ci: "CI",
  tests: "Tests",
  review: "Review",
  security: "Security",
  ui_evidence: "UI evidence",
  size: "Size",
};
const checkStyle = {
  pass: { icon: Check, cls: "border-status-done/30 bg-status-done/10 text-status-done" },
  fail: { icon: X, cls: "border-status-failed/30 bg-status-failed/10 text-status-failed" },
  pending: { icon: Clock, cls: "border-border text-muted-foreground" },
  skipped: { icon: Minus, cls: "border-border text-muted-foreground/60" },
};

export function ChecksColumn({ checks }: { checks: MergeCheckResult[] }) {
  return (
    <Column title="Merge checks" count={checks.length}>
      {checks.map((pr) => (
        <div key={pr.prNumber} className="rounded-md px-2 py-1.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px]">
            <span className="font-mono text-3xs text-muted-foreground">#{pr.prNumber}</span>
            <span className="truncate">{pr.title}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {pr.checks.map((c) => {
              const s = checkStyle[c.state];
              return (
                <span
                  key={c.name}
                  title={c.detail}
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-3xs",
                    s.cls,
                  )}
                >
                  <s.icon className="size-2.5" /> {checkLabel[c.name]}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </Column>
  );
}

const recentStyle = {
  merged: { icon: GitMerge, cls: "text-chart-4", label: "merged" },
  reverted: { icon: Undo2, cls: "text-status-failed", label: "reverted" },
  rejected: { icon: X, cls: "text-muted-foreground", label: "rejected" },
};

export function RecentColumn({ recent }: { recent: FactoryWorkItem[] }) {
  return (
    <Column title="Recent merges & reverts" count={recent.length}>
      {recent.map((w) => {
        const s = recentStyle[w.stage as keyof typeof recentStyle] ?? recentStyle.merged;
        return (
          <div key={w.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]">
            <s.icon className={cn("size-3.5 shrink-0", s.cls)} />
            <span className={cn("truncate", w.stage === "rejected" && "text-muted-foreground")}>
              {w.title}
            </span>
            <span className={cn("ml-auto shrink-0 text-3xs", s.cls)}>{s.label}</span>
          </div>
        );
      })}
    </Column>
  );
}
