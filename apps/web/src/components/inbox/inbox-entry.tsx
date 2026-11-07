import type { InboxItem } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Check,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { ApprovalCard } from "@/components/thread/cards/approval-card";
import { QuestionCard } from "@/components/thread/cards/question-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { ago } from "@/lib/format";
import { platform } from "@/lib/platform";
import { useProject, useTranscript } from "@/lib/queries";

/** The mirrored approval or question, answered with the same card as the transcript. */
function MirroredRequest({ item }: { item: InboxItem }) {
  const { transcript } = useTranscript(item.sessionId ?? undefined);
  const mirrored = item.itemId ? transcript?.items[item.itemId]?.item : undefined;
  if (!item.sessionId) return null;
  if (!transcript) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (mirrored?.kind === "approval_request")
    return <ApprovalCard item={mirrored} sessionId={item.sessionId} compact />;
  if (mirrored?.kind === "user_question")
    return <QuestionCard item={mirrored} sessionId={item.sessionId} />;
  return null;
}

function Actions({ item }: { item: InboxItem }) {
  const client = useClient();
  const resolve = useMutation({
    mutationFn: (action: string) => client.resolveInbox(item.id, { action }),
    onSuccess: (_d, action) =>
      toast.success(
        {
          merge: "Merging when checks pass",
          accept: "The PM will start a session",
          needs_info: "Asked for more info on the issue",
          decline: "Declined",
          dismiss: "Dismissed",
          changes: "Changes requested",
        }[action] ?? "Done",
      ),
  });
  const retry = useMutation({
    mutationFn: async () => {
      if (item.sessionId)
        await client.sendMessage(
          item.sessionId,
          { text: "Retry the failed step. Pin React to 19.2 first if the peer conflict remains." },
          "send",
        );
      await client.resolveInbox(item.id, { action: "retry" });
    },
    onSuccess: () => toast.success("Retrying"),
  });
  const busy = resolve.isPending || retry.isPending;

  switch (item.kind) {
    case "pr_review":
      return (
        <>
          <Button size="sm" onClick={() => resolve.mutate("merge")} disabled={busy}>
            <Check /> Approve & merge
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resolve.mutate("changes")}
            disabled={busy}
          >
            Request changes
          </Button>
          {item.pr && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => item.pr && platform.openExternal(item.pr.url)}
            >
              <ExternalLink /> GitHub
            </Button>
          )}
        </>
      );
    case "run_failed":
      return (
        <>
          <Button size="sm" onClick={() => retry.mutate()} disabled={busy}>
            <RotateCcw /> Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => resolve.mutate("dismiss")}
            disabled={busy}
          >
            Dismiss
          </Button>
        </>
      );
    case "triage":
      return (
        <>
          <Button size="sm" onClick={() => resolve.mutate("accept")} disabled={busy}>
            <Check /> Take it on
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resolve.mutate("needs_info")}
            disabled={busy}
          >
            Needs info
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => resolve.mutate("decline")}
            disabled={busy}
          >
            <X /> Decline
          </Button>
        </>
      );
    case "automation_result":
    case "message":
      return (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => resolve.mutate("dismiss")}
          disabled={busy}
        >
          Dismiss
        </Button>
      );
    default:
      return null;
  }
}

/** One inbox item: context line, title, body, links, and the in-place answer (§11.1). */
export function InboxEntry({ item }: { item: InboxItem }) {
  const project = useProject(item.projectId);
  const resolved = item.status !== "open";
  const mirrors = item.kind === "approval" || item.kind === "question";
  return (
    <article className={resolved ? "opacity-60" : "animate-rise"}>
      <div className="mb-1.5 flex items-center gap-2 text-2xs text-muted-foreground">
        {project && <ProjectTile project={project} />}
        <span>{project?.name ?? "Global"}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{ago(item.createdAt)}</span>
        {item.priority === "high" && (
          <span className="rounded-full bg-status-failed/12 px-1.5 text-3xs font-medium text-status-failed">
            high
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {item.issue && (
            <button
              type="button"
              onClick={() => item.issue && platform.openExternal(item.issue.url)}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <CircleDot className="size-3 text-status-done" />#{item.issue.number}
            </button>
          )}
          {item.pr && (
            <button
              type="button"
              onClick={() => item.pr && platform.openExternal(item.pr.url)}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <GitPullRequest className="size-3 text-status-done" />#{item.pr.number}
            </button>
          )}
          {item.sessionId && (
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: item.sessionId }}
              className="flex items-center gap-0.5 hover:text-foreground"
            >
              Session <ArrowUpRight className="size-3" />
            </Link>
          )}
        </span>
      </div>
      {mirrors && !resolved ? (
        <MirroredRequest item={item} />
      ) : (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <h3 className="text-[14px] font-medium">{item.title}</h3>
          {item.body && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
          )}
          {!resolved && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Actions item={item} />
            </div>
          )}
          {resolved && (
            <p className="mt-2 text-2xs text-status-done">
              Resolved {item.resolvedAt ? ago(item.resolvedAt) : ""}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
