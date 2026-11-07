import type { UsageDimension, UsageQuery } from "@codeden/contracts";
import { ChartColumnBig, Download, Info, X } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRateLimits, useUsageApi, useUsageReport } from "@/components/usage/api";
import { AutomationSpend } from "@/components/usage/automation-spend";
import { BudgetsPanel } from "@/components/usage/budgets";
import type { ChartMetric, DrillTarget } from "@/components/usage/daily-chart";
import { isApiEquivalent, longDay, shortDay } from "@/components/usage/format";
import { PricesDialog } from "@/components/usage/prices-dialog";
import { presetRange, RangePicker, type UsageRange } from "@/components/usage/range-picker";
import { RateLimitMeters } from "@/components/usage/rate-limits";
import { TopSessionsTable } from "@/components/usage/top-sessions";
import { UnpricedNote, UsageTotals } from "@/components/usage/totals";
import { useSnapshotData } from "@/lib/queries";
import { PageHeader } from "../page-header";
import { SpendCard } from "./spend-card";

type Filters = Pick<UsageQuery, "projectId" | "provider" | "model" | "role" | "source">;
type Filter = { field: keyof Filters; value: string; label: string };

const FIELD_OF: Record<UsageDimension, keyof Filters> = {
  provider: "provider",
  model: "model",
  project: "projectId",
  role: "role",
  source: "source",
};
const FIELD_NAMES: Record<keyof Filters, string> = {
  provider: "Provider",
  model: "Model",
  projectId: "Project",
  role: "Role",
  source: "Started by",
};

function toQuery(range: UsageRange, filters: Filter[]): UsageQuery {
  const q: Record<string, string> = { from: range.from, to: range.to };
  for (const f of filters) q[f.field] = f.value;
  return q as UsageQuery;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Usage and cost reports (§12.6): totals, daily charts, breakdowns, limits and budgets. */
export function ReportsPage({ projectId }: { projectId?: string }) {
  const api = useUsageApi();
  const projectName = useSnapshotData(
    (s) => s.projects.find((p) => p.id === projectId)?.name,
    undefined,
  );
  const [range, setRange] = useState<UsageRange>(() => presetRange("30d"));
  const [filters, setFilters] = useState<Filter[]>(() =>
    projectId ? [{ field: "projectId", value: projectId, label: projectName ?? "Project" }] : [],
  );
  const [dimension, setDimension] = useState<UsageDimension>("model");
  const [metric, setMetric] = useState<ChartMetric>("cost");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const query = toQuery(range, filters);
  const report = useUsageReport(query);
  const drillQuery = drill
    ? {
        ...query,
        from: drill.day,
        to: drill.day,
        ...(drill.key && drill.key !== "__other" ? { [FIELD_OF[drill.dimension]]: drill.key } : {}),
      }
    : null;
  const drilled = useUsageReport(drillQuery);
  const limits = useRateLimits();
  const data = report.data;

  const pick = (key: string) => {
    const series = data?.series[dimension].find((s) => s.key === key);
    const field = FIELD_OF[dimension];
    setFilters((fs) => [
      ...fs.filter((f) => f.field !== field),
      { field, value: key, label: series?.label ?? key },
    ]);
    setDrill(null);
  };

  return (
    <>
      <PageHeader
        icon={<ChartColumnBig />}
        title="Usage and cost"
        meta={
          data ? `${shortDay(range.from)} – ${shortDay(range.to)} · ${data.timezone}` : undefined
        }
        actions={
          <>
            <PricesDialog />
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
              <a href={api.csvUrl(query)} download>
                <Download className="size-3.5" /> Export CSV
              </a>
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6" data-testid="reports-page">
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker
              value={range}
              onChange={(r) => {
                setRange(r);
                setDrill(null);
              }}
            />
            {filters.map((f) => (
              <button
                key={f.field}
                type="button"
                onClick={() => setFilters((fs) => fs.filter((x) => x.field !== f.field))}
                aria-label={`Remove filter ${FIELD_NAMES[f.field]}: ${f.label}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pr-2 pl-3 text-xs hover:bg-primary/20"
              >
                <span className="text-muted-foreground">{FIELD_NAMES[f.field]}</span>
                <span className="font-medium">{f.label}</span>
                <X className="size-3" />
              </button>
            ))}
          </div>

          {data && isApiEquivalent(data.billing) && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <p>
                Costs are <span className="font-medium text-foreground">API-equivalent</span>: you
                use a subscription login, so this is what the same work would cost on API credits,
                not what you are billed. Figures marked ≈ are estimated from the price table.
              </p>
            </div>
          )}

          {!data ? (
            report.isError ? (
              <EmptyState icon={<ChartColumnBig />} title="Couldn't load usage" className="py-20">
                {report.error.message}
              </EmptyState>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-[88px] rounded-xl" />
                  ))}
                </div>
                <Skeleton className="h-96 rounded-xl" />
              </div>
            )
          ) : (
            <div className={report.isPlaceholderData ? "space-y-6 opacity-60" : "space-y-6"}>
              <UsageTotals report={data} />
              <UnpricedNote report={data} />
              <SpendCard
                report={data}
                dimension={dimension}
                metric={metric}
                onDimension={setDimension}
                onMetric={setMetric}
                onDrill={setDrill}
                onPick={pick}
              />
              {drill && (
                <section className="rounded-xl border border-primary/40 bg-card">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                    <h2 className="text-sm font-medium">
                      Sessions behind {longDay(drill.day)} · {drill.label}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto"
                      aria-label="Close"
                      onClick={() => setDrill(null)}
                    >
                      <X />
                    </Button>
                  </div>
                  <div className="px-2">
                    <TopSessionsTable sessions={drilled.data?.topSessions ?? []} limit={25} />
                  </div>
                </section>
              )}
              <Section title="Subscription limits">
                <RateLimitMeters data={limits.data} />
              </Section>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                <Section title="Top sessions by cost">
                  <div className="rounded-xl border border-border bg-card px-2">
                    <TopSessionsTable sessions={data.topSessions} />
                  </div>
                </Section>
                <div className="space-y-6">
                  <Section title="Background work">
                    <AutomationSpend report={data} />
                  </Section>
                  <BudgetsPanel />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
