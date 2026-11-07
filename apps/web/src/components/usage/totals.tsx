import type { UsageReport } from "@codeden/contracts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isApiEquivalent, money, percent, tokens, totalTokens, trend } from "./format";

function Tile({
  label,
  value,
  sub,
  delta,
  testId,
}: {
  label: ReactNode;
  value: string;
  sub: ReactNode;
  delta?: { text: string; up: boolean } | null;
  testId?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span data-testid={testId} className="truncate text-2xl font-semibold tabular-nums">
          {value}
        </span>
        {delta && (
          <span
            title="Compared with the previous period of the same length"
            className="inline-flex items-center text-2xs text-muted-foreground tabular-nums"
          >
            {delta.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-2xs text-muted-foreground tabular-nums">{sub}</div>
    </div>
  );
}

/** Headline numbers for the range: spend, tokens, cache hit rate and averages. */
export function UsageTotals({ report }: { report: UsageReport }) {
  const t = report.totals;
  const p = report.previousTotals;
  const estimated = t.estimatedCostUsd > 0;
  const apiEquivalent = isApiEquivalent(report.billing);
  const perDay = t.costUsd / Math.max(1, report.days.length);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile
        testId="usage-total"
        label={
          <>
            {apiEquivalent ? "API-equivalent cost" : "Spend"}
            {apiEquivalent && (
              <span
                className="rounded border border-border px-1 text-3xs"
                title="You use a subscription login: this is what the same work would cost on API credits, not your bill."
              >
                subscription
              </span>
            )}
          </>
        }
        value={money(t.costUsd, estimated)}
        delta={trend(t.costUsd, p.costUsd)}
        sub={
          estimated
            ? `${money(perDay)}/day · ${money(t.estimatedCostUsd)} estimated`
            : `${money(perDay)} a day on average`
        }
      />
      <Tile
        testId="usage-tokens"
        label="Tokens"
        value={tokens(totalTokens(t))}
        delta={trend(totalTokens(t), totalTokens(p))}
        sub={`${tokens(t.inputTokens)} in · ${tokens(t.outputTokens)} out · ${tokens(t.cacheReadTokens)} cached`}
      />
      <Tile
        label="Cache hit rate"
        value={percent(t.cacheHitRate)}
        sub={`${tokens(t.cacheWriteTokens)} written to cache`}
      />
      <Tile
        label="Per session"
        value={
          report.averages.perSessionUsd === null
            ? "—"
            : money(report.averages.perSessionUsd, estimated)
        }
        sub={`${t.sessions.toLocaleString("en-US")} sessions · ${t.turns.toLocaleString("en-US")} turns`}
      />
      <Tile
        label="Per merged PR"
        value={
          report.averages.perMergedPrUsd === null ? "—" : money(report.averages.perMergedPrUsd)
        }
        sub={
          report.averages.mergedPrs > 0
            ? `${report.averages.mergedPrs} merged PRs`
            : "No merged PRs in range"
        }
      />
    </div>
  );
}

/** A short note under the totals when some turns could not be priced. */
export function UnpricedNote({ report, className }: { report: UsageReport; className?: string }) {
  if (report.totals.unpricedTurns === 0) return null;
  return (
    <p className={cn("text-2xs text-muted-foreground", className)}>
      {report.totals.unpricedTurns} turns ran on models with no price and no reported cost; their
      tokens are counted but cost $0. Add a price under Prices.
    </p>
  );
}
