import { Link } from "@tanstack/react-router";
import { ArrowRight, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjectSpend } from "./api";
import { isApiEquivalent, localToday, longDay, money, shiftDay } from "./format";

/** Project home spend card: today, 7 days and month to date, a 14-day trend and budgets. */
export function ProjectSpendCard({ projectId }: { projectId: string }) {
  const { data } = useProjectSpend(projectId);
  if (!data) return null;
  const max = Math.max(...data.dailyUsd, 0.01);
  const first = shiftDay(localToday(), -13);
  const stats = [
    { label: "Today", value: data.todayUsd },
    { label: "7 days", value: data.last7Usd },
    { label: "This month", value: data.monthUsd },
  ];
  return (
    <section
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid="project-spend"
    >
      <div className="flex items-center gap-2">
        <Coins className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">
          {isApiEquivalent(data.billing) ? "API-equivalent spend" : "Spend"}
        </h2>
        {data.topModel && (
          <span className="text-2xs text-muted-foreground">
            mostly <span className="font-mono">{data.topModel}</span>
          </span>
        )}
        <Link
          to="/reports"
          search={{ project: projectId }}
          className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
        >
          Full report <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-2xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold tabular-nums">
              {money(s.value, data.estimated)}
            </div>
          </div>
        ))}
        <div
          className="ml-auto flex h-10 min-w-40 flex-1 items-end gap-0.5 sm:max-w-72"
          role="img"
          aria-label="Daily spend over the last 14 days"
        >
          {data.dailyUsd.map((v, i) => {
            const day = shiftDay(first, i);
            return (
              <div
                key={day}
                title={`${longDay(day)}: ${money(v)}`}
                className={cn(
                  "flex-1 rounded-t-[3px] bg-primary/70 hover:bg-primary",
                  v === 0 && "bg-muted",
                )}
                style={{ height: `${v === 0 ? 6 : Math.max(10, (v / max) * 100)}%` }}
              />
            );
          })}
        </div>
      </div>
      {data.budgets.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-2 text-2xs text-muted-foreground">
          {data.budgets.map((b) => (
            <div key={b.budget.id} className="flex items-center gap-2 tabular-nums">
              <span>{b.budget.period === "daily" ? "Daily" : "Monthly"} budget</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    b.state === "exceeded"
                      ? "bg-status-failed"
                      : b.state === "warning"
                        ? "bg-status-waiting"
                        : "bg-status-done",
                  )}
                  style={{ width: `${Math.min(100, b.percent)}%` }}
                />
              </span>
              <span>
                {money(b.spentUsd)} / {money(b.budget.limitUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
