import type { UsageDimension, UsageReport } from "@codeden/contracts";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { axisMoney, longDay, money, shortDay, tokens } from "./format";
import { chartConfig, seriesVar } from "./palette";

export type ChartMetric = "cost" | "tokens";

export interface DrillTarget {
  day: string;
  dimension: UsageDimension;
  key: string;
  label: string;
}

type Row = { day: string } & Record<string, number | string>;

/**
 * Stacked bars per day for one dimension (cost or tokens). Clicking a segment drills into the
 * sessions behind it.
 */
export function DailyChart({
  report,
  dimension,
  metric,
  onDrill,
}: {
  report: UsageReport;
  dimension: UsageDimension;
  metric: ChartMetric;
  onDrill?: (target: DrillTarget) => void;
}) {
  const series = report.series[dimension];
  const config = chartConfig(series);
  const rows: Row[] = report.days.map((day, i) => {
    const row: Row = { day };
    series.forEach((s, j) => {
      row[seriesVar(j)] = metric === "cost" ? (s.dailyCostUsd[i] ?? 0) : (s.dailyTokens[i] ?? 0);
    });
    return row;
  });
  const format = metric === "cost" ? (v: number) => money(v) : (v: number) => tokens(v);
  const many = report.days.length > 31;

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-72 w-full [&_*:focus]:outline-none"
      data-testid="daily-chart"
    >
      <BarChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={many ? 24 : 12}
          tickFormatter={(d: string) => shortDay(d)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v: number) => (metric === "cost" ? axisMoney(v) : tokens(v))}
        />
        <ChartTooltip
          cursor={{ fillOpacity: 0.5 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const day = (payload?.[0]?.payload as Row | undefined)?.day;
                return day ? longDay(day) : "";
              }}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: item.color }}
                  />
                  <span className="text-muted-foreground">
                    {config[String(name)]?.label ?? name}
                  </span>
                  <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                    {format(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s, j) => (
          <Bar
            key={s.key}
            dataKey={seriesVar(j)}
            stackId="day"
            fill={`var(--color-${seriesVar(j)})`}
            stroke="var(--card)"
            strokeWidth={1}
            radius={j === series.length - 1 ? [4, 4, 0, 0] : 0}
            className={onDrill ? "cursor-pointer" : undefined}
            onClick={(entry: { payload?: Row }) => {
              const day = entry.payload?.day;
              if (day && onDrill) onDrill({ day, dimension, key: s.key, label: s.label });
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
