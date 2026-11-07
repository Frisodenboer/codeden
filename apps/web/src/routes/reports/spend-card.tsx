import type { UsageDimension, UsageReport } from "@codeden/contracts";
import { BreakdownTable, DIMENSION_LABELS } from "@/components/usage/breakdown";
import { type ChartMetric, DailyChart, type DrillTarget } from "@/components/usage/daily-chart";
import { cn } from "@/lib/utils";

const DIMENSIONS: UsageDimension[] = ["provider", "model", "project", "role", "source"];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-background/40 p-0.5 text-xs"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-6 rounded-md px-2 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            value === o.id && "bg-accent text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The daily stacked chart and its breakdown table, sharing one dimension picker. */
export function SpendCard({
  report,
  dimension,
  metric,
  onDimension,
  onMetric,
  onDrill,
  onPick,
}: {
  report: UsageReport;
  dimension: UsageDimension;
  metric: ChartMetric;
  onDimension: (d: UsageDimension) => void;
  onMetric: (m: ChartMetric) => void;
  onDrill: (t: DrillTarget) => void;
  onPick: (key: string) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="mr-auto text-sm font-medium">
          {metric === "cost" ? "Daily spend" : "Daily tokens"}
          <span className="ml-2 text-2xs font-normal text-muted-foreground">
            by {DIMENSION_LABELS[dimension].toLowerCase()} · click a bar for its sessions
          </span>
        </h2>
        <Segmented
          label="Break down by"
          value={dimension}
          onChange={onDimension}
          options={DIMENSIONS.map((d) => ({ id: d, label: DIMENSION_LABELS[d] }))}
        />
        <Segmented
          label="Measure"
          value={metric}
          onChange={onMetric}
          options={[
            { id: "cost", label: "Cost" },
            { id: "tokens", label: "Tokens" },
          ]}
        />
      </div>
      <div className="px-3 pt-4 pb-2">
        <DailyChart report={report} dimension={dimension} metric={metric} onDrill={onDrill} />
      </div>
      <div className="border-t border-border px-2 pb-1">
        <BreakdownTable report={report} dimension={dimension} onPick={onPick} />
      </div>
    </section>
  );
}
