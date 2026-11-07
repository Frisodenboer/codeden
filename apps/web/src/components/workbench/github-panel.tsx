import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  GitPullRequest,
  XCircle,
} from "lucide-react";
import { EmptyState } from "@/components/common/bits";
import { Markdown } from "@/components/thread/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";

const checkIcon = { pass: CheckCircle2, fail: XCircle, pending: Clock };
const checkTone = {
  pass: "text-status-done",
  fail: "text-status-failed",
  pending: "text-status-waiting",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The session's linked issue and pull request (§9). */
export function GitHubPanel({ sessionId }: { sessionId: string }) {
  const client = useClient();
  const { data, isLoading } = useQuery({
    queryKey: ["github", sessionId],
    queryFn: () => client.getPrDetails(sessionId),
  });
  if (isLoading)
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-20" />
      </div>
    );
  if (!data?.issue && !data?.pr) {
    return (
      <EmptyState icon={<GitPullRequest />} title="No issue or PR linked" className="h-full">
        Sessions started from an issue link it here; the PR appears once the agent opens one.
      </EmptyState>
    );
  }
  return (
    <div className="h-full space-y-6 overflow-y-auto p-4 scroll-thin">
      {data.pr && (
        <Section title="Pull request">
          <button
            type="button"
            onClick={() => data.pr && platform.openExternal(data.pr.url)}
            className="group flex w-full items-start gap-2 text-left"
          >
            <GitPullRequest
              className={cn(
                "mt-0.5 size-4 shrink-0",
                data.pr.state === "draft" ? "text-muted-foreground" : "text-status-done",
              )}
            />
            <span className="flex-1 text-[14px] font-medium group-hover:underline">
              {data.pr.title}{" "}
              <span className="font-normal text-muted-foreground">#{data.pr.number}</span>
            </span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-px capitalize">
              {data.pr.state}
            </span>
            <span className="text-diff-add">+{data.pr.additions}</span>
            <span className="text-diff-del">−{data.pr.deletions}</span>
            {data.pr.reviews.map((r) => (
              <span key={r.author} className={cn(r.state === "approved" && "text-status-done")}>
                {r.author} {r.state.replace("_", " ")}
              </span>
            ))}
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {data.pr.checks.map((c) => {
              const Icon = checkIcon[c.state];
              return (
                <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                  <Icon className={cn("size-3.5", checkTone[c.state])} />
                  <span className="flex-1 font-mono text-[12px]">{c.name}</span>
                  <span className="text-2xs text-muted-foreground capitalize">{c.state}</span>
                </div>
              );
            })}
          </div>
          <Markdown className="text-[13px]">{data.pr.body}</Markdown>
        </Section>
      )}
      {data.issue && (
        <Section title="Issue">
          <button
            type="button"
            onClick={() => data.issue && platform.openExternal(data.issue.url)}
            className="group flex w-full items-start gap-2 text-left"
          >
            <CircleDot className="mt-0.5 size-4 shrink-0 text-status-done" />
            <span className="flex-1 text-[14px] font-medium group-hover:underline">
              {data.issue.title}{" "}
              <span className="font-normal text-muted-foreground">#{data.issue.number}</span>
            </span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </button>
          <div className="flex flex-wrap gap-1.5">
            {data.issue.labels.map((l) => (
              <span
                key={l}
                className="rounded-full bg-muted px-2 py-px text-3xs text-muted-foreground"
              >
                {l}
              </span>
            ))}
          </div>
          <Markdown className="text-[13px]">{data.issue.body}</Markdown>
        </Section>
      )}
    </div>
  );
}
