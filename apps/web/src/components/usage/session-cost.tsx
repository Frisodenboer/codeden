import type { SessionUsage } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranscriptsStore } from "@/stores/transcripts";
import { usageKeys, useSessionUsage } from "./api";
import { money, percent, tokens, totalTokens } from "./format";

/** The session's ledger figures, refreshed whenever its live usage changes. */
function useLiveSessionUsage(sessionId: string) {
  const queryClient = useQueryClient();
  const live = useTranscriptsStore((s) => s.byId[sessionId]?.usage);
  const marker = `${live?.inputTokens ?? 0}:${live?.outputTokens ?? 0}:${live?.costUsd ?? 0}`;
  useEffect(() => {
    if (marker === "0:0:0") return;
    void queryClient.invalidateQueries({ queryKey: usageKeys.session(sessionId) });
  }, [marker, queryClient, sessionId]);
  return useSessionUsage(sessionId);
}

function costLabel(u: SessionUsage): string {
  return money(u.totals.costUsd, u.totals.estimatedCostUsd > 0);
}

/** Cost and tokens chip for the session header, with a breakdown on hover. */
export function SessionCostChip({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { data } = useLiveSessionUsage(sessionId);
  if (!data || data.totals.turns === 0) return null;
  const t = data.totals;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="session-cost"
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md border border-border/80 px-2 text-2xs whitespace-nowrap text-muted-foreground tabular-nums",
            className,
          )}
        >
          <Coins className="size-3" />
          <span className="text-foreground/90">{costLabel(data)}</span>
          <span className="text-muted-foreground/60">·</span>
          {tokens(totalTokens(t))} tok
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-1 text-2xs">
        <div className="font-medium">
          {data.billing === "subscription" ? "API-equivalent cost" : "Session cost"}
          {t.estimatedCostUsd > 0 ? " (estimated from list prices)" : ""}
        </div>
        <div className="tabular-nums">
          {tokens(t.inputTokens)} input · {tokens(t.outputTokens)} output
        </div>
        <div className="tabular-nums">
          {tokens(t.cacheReadTokens)} cache reads · {tokens(t.cacheWriteTokens)} cache writes
        </div>
        <div className="tabular-nums">
          {t.turns} turns · cache hit rate {percent(t.cacheHitRate)}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** "$0.42 · 38k tokens" for one turn, for the turn footer; null until the turn has usage. */
export function useTurnCostText(sessionId: string, turnId: string): string | null {
  const { data } = useSessionUsage(sessionId);
  const turn = data?.turns.find((t) => t.turnId === turnId);
  if (!turn) return null;
  const total = turn.inputTokens + turn.outputTokens + turn.cacheReadTokens + turn.cacheWriteTokens;
  return `${money(turn.costUsd, turn.costSource === "estimated")} · ${tokens(total)} tokens`;
}
