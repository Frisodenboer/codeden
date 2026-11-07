import type { GitHubIssueRef, GitHubPrRef } from "@codeden/contracts";
import { CircleDot, GitMerge, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small uppercase section label used in sidebars and panels. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-2xs font-medium tracking-[0.08em] text-muted-foreground/80 uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Centered empty state with an icon tile. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 p-8 text-center", className)}
    >
      <div className="mb-1 flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs [&_svg]:size-[18px]">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <div className="max-w-72 text-xs leading-relaxed text-muted-foreground">{children}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const providerHue: Record<string, number> = { claude: 35, codex: 220, fake: 300 };

/** Provider monogram tile. Colour is decorative only; behaviour never depends on the id. */
export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const hue = providerHue[provider] ?? (provider.charCodeAt(0) * 37) % 360;
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] text-3xs font-semibold uppercase",
        className,
      )}
      style={{
        background: `oklch(0.72 0.12 ${hue} / 0.18)`,
        color: `oklch(0.72 0.14 ${hue})`,
      }}
      aria-hidden
    >
      {provider.charAt(0)}
    </span>
  );
}

/** GitHub issue badge: `#142`. */
export function IssueBadge({ issue, className }: { issue: GitHubIssueRef; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-full border border-border px-1.5 font-mono text-3xs text-muted-foreground tabular-nums",
        className,
      )}
      title={issue.title}
    >
      <CircleDot className="size-2.5 text-status-done" />
      {issue.number}
    </span>
  );
}

const prIcon = {
  draft: GitPullRequestDraft,
  open: GitPullRequest,
  merged: GitMerge,
  closed: GitPullRequest,
};
const prColor = {
  draft: "text-muted-foreground",
  open: "text-status-done",
  merged: "text-chart-4",
  closed: "text-status-failed",
};

/** GitHub PR badge: `PR 57` with state colour. */
export function PrBadge({ pr, className }: { pr: GitHubPrRef; className?: string }) {
  const Icon = prIcon[pr.state];
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-full border border-border px-1.5 font-mono text-3xs text-muted-foreground tabular-nums",
        className,
      )}
      title={`${pr.title ?? "Pull request"} (${pr.state})`}
    >
      <Icon className={cn("size-2.5", prColor[pr.state])} />
      {pr.number}
    </span>
  );
}

/** Inline keyboard hint like `Ctrl K`. */
export function Hotkey({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.split(" ").map((k) => (
        <kbd
          key={k}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-border bg-muted/60 px-1 font-sans text-3xs font-medium text-muted-foreground"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
