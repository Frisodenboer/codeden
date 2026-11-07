import type { UsageReport } from "@codeden/contracts";
import { Workflow } from "lucide-react";
import { useResolvedTheme } from "@/stores/theme";
import { money, percent } from "./format";
import { SERIES_COLORS } from "./palette";

/** Where background work's spend goes: you vs automations vs the factory, then per automation. */
export function AutomationSpend({ report }: { report: UsageReport }) {
  const theme = useResolvedTheme();
  const { manualCostUsd, automationCostUsd, factoryCostUsd, byAutomation } = report.automations;
  const total = manualCostUsd + automationCostUsd + factoryCostUsd;
  const parts = [
    { label: "Interactive", value: manualCostUsd, color: SERIES_COLORS[0]?.[theme] },
    { label: "Automations", value: automationCostUsd, color: SERIES_COLORS[2]?.[theme] },
    { label: "Factory", value: factoryCostUsd, color: SERIES_COLORS[6]?.[theme] },
  ];
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Workflow className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Automation and factory spend</h3>
      </div>
      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          parts.map((p) =>
            p.value > 0 ? (
              <div
                key={p.label}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
                title={`${p.label}: ${money(p.value)}`}
              />
            ) : null,
          )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {parts.map((p) => (
          <div key={p.label} className="min-w-0">
            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="size-2 rounded-[3px]" style={{ background: p.color }} />
              {p.label}
            </div>
            <div className="text-sm font-medium tabular-nums">
              {money(p.value)}{" "}
              <span className="text-2xs font-normal text-muted-foreground">
                {percent(total > 0 ? p.value / total : null)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {byAutomation.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
          {byAutomation.slice(0, 6).map((a) => (
            <li key={a.automationId} className="flex items-center gap-2">
              <span className="truncate">{a.name}</span>
              <span className="text-2xs text-muted-foreground">
                {a.sessions} {a.sessions === 1 ? "run" : "runs"}
              </span>
              <span className="ml-auto font-mono tabular-nums">{money(a.costUsd)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-2xs text-muted-foreground">
          No automation runs in this range.
        </p>
      )}
    </div>
  );
}
