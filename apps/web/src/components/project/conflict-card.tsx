import type { ConflictDecision } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock, GitMerge, ListPlus, SkipForward, Swords, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClient } from "@/lib/api";
import type { ConflictCase } from "@/lib/api/types";
import { ago } from "@/lib/format";

const startedBy = {
  user: "you",
  orchestrator: "the orchestrator",
  pm: "the PM",
  automation: "an automation",
};

/**
 * A start request that matched running work (§8.4). The same four choices as the agents get:
 * wait (queue behind), skip, join (send as a follow-up) or force (with a recorded reason).
 */
export function ConflictCard({
  conflict,
  onResolved,
}: {
  conflict: ConflictCase;
  onResolved?: () => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [forcing, setForcing] = useState(false);
  const [reason, setReason] = useState("");
  const existing = conflict.existing[0];
  const resolve = useMutation({
    mutationFn: (decision: ConflictDecision) => client.resolveConflict(conflict, decision),
    onSuccess: (_d, decision) => {
      toast.success(
        {
          wait: "Queued behind the running work",
          skip: "Skipped",
          join: "Sent to the running session",
          force: "Started anyway",
        }[decision.resolution],
      );
      void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
      onResolved?.();
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-chart-5/30 bg-card">
      <div className="flex items-center gap-2 border-b border-chart-5/15 bg-chart-5/[0.06] px-3.5 py-2">
        <Swords className="size-4 text-chart-5" />
        <span className="text-2xs font-semibold tracking-wider text-chart-5 uppercase">
          Already running
        </span>
        <code className="ml-auto rounded bg-background/60 px-1.5 py-px font-mono text-3xs text-muted-foreground">
          {conflict.request.workKey}
        </code>
      </div>
      <div className="space-y-3 px-3.5 py-3">
        <p className="text-[13px]">
          <span className="font-medium">{conflict.request.requestedBy}</span> asked to{" "}
          <span className="font-medium">“{conflict.request.purpose}”</span>, but matching work is
          already in progress:
        </p>
        {existing && (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
            <StatusDot
              tone={existing.status === "running" ? "running" : "waiting"}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{existing.purpose}</div>
              <div className="text-2xs text-muted-foreground">
                Started by {startedBy[existing.startedBy.kind]} · {ago(existing.startedAt)}
                {existing.progress && ` · ${existing.progress.text}`}
              </div>
            </div>
            {existing.sessionId && (
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: existing.sessionId }}
                className="shrink-0 text-2xs text-primary hover:underline"
              >
                Open
              </Link>
            )}
          </div>
        )}
        {forcing ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why start a duplicate? (recorded)"
              className="h-8 text-[13px]"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ resolution: "force", reason })}
            >
              Start anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForcing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              onClick={() => resolve.mutate({ resolution: "wait", behindId: existing?.id })}
              disabled={resolve.isPending}
            >
              <Clock /> Wait
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!existing?.sessionId || resolve.isPending}
              onClick={() =>
                existing?.sessionId &&
                resolve.mutate({ resolution: "join", sessionId: existing.sessionId })
              }
            >
              <GitMerge /> Join
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => resolve.mutate({ resolution: "skip" })}
              disabled={resolve.isPending}
            >
              <SkipForward /> Skip
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setForcing(true)}
            >
              <Zap /> Force…
            </Button>
            <span className="ml-auto flex items-center gap-1 self-center text-3xs text-muted-foreground/70">
              <ListPlus className="size-3" /> Wait queues it to start when the current run finishes
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
