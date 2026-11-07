import type { Session } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { IssueBadge, PrBadge } from "@/components/common/bits";
import { ChecksBadge } from "@/components/github/github-bits";
import { useClient } from "@/lib/api";
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout";

/**
 * Issue and PR badges in the thread header, with the PR's live checks from
 * `/api/sessions/:id/github`. Clicking opens the Issue / PR tab.
 */
export function SessionGithubBadges({
  session,
  className,
}: {
  session: Session;
  className?: string;
}) {
  const client = useClient();
  const project = useProject(session.projectId);
  const openTab = useLayoutStore((s) => s.openRightTab);
  const enabled = project?.kind === "github" && session.role === "agent";
  const { data } = useQuery({
    queryKey: ["github", "session", session.id],
    queryFn: () => client.github.session(session.id),
    enabled,
    refetchInterval: 30_000,
  });
  const issue = data?.issue ?? session.issue;
  const pr = data?.pr ?? null;
  const prRef = pr
    ? { number: pr.number, url: pr.url, state: pr.state, title: pr.title }
    : session.pr;
  if (!issue && !prRef) return null;
  const open = () => (session.worktreePath ? openTab("github") : undefined);
  return (
    <span className={cn("items-center gap-1.5", className)} data-testid="session-github-badges">
      {issue && (
        <button type="button" onClick={open} title={issue.title ?? `Issue #${issue.number}`}>
          <IssueBadge issue={issue} className="h-6" />
        </button>
      )}
      {prRef && (
        <button
          type="button"
          onClick={open}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-border pr-1.5"
          title={prRef.title ?? `PR #${prRef.number}`}
        >
          <PrBadge pr={prRef} className="h-6 border-0" />
          {pr && <ChecksBadge checks={pr.checks} withCount={false} />}
        </button>
      )}
    </span>
  );
}
