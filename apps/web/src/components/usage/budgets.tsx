import type { BudgetStatus, UsageBudget, UsageSettings } from "@codeden/contracts";
import { BellRing, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useBudgets, useSaveUsageSettings, useUsageSettings } from "./api";
import { money } from "./format";

const STATE_BAR: Record<BudgetStatus["state"], string> = {
  ok: "bg-status-done",
  warning: "bg-status-waiting",
  exceeded: "bg-status-failed",
};
const STATE_TEXT: Record<BudgetStatus["state"], string> = {
  ok: "On track",
  warning: "Near the limit",
  exceeded: "Over the limit",
};

function BudgetRow({
  status,
  scope,
  onDelete,
}: {
  status: BudgetStatus;
  scope: string;
  onDelete: () => void;
}) {
  const { budget, spentUsd, percent, state } = status;
  return (
    <div className="space-y-1.5 py-3" data-testid="budget-row">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{scope}</span>
        <span className="text-muted-foreground">
          · {budget.period === "daily" ? "per day" : "per month"} · alert at {budget.warnAtPercent}%
        </span>
        <span
          className={cn(
            "ml-auto text-2xs",
            state === "ok" ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {STATE_TEXT[state]}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${scope} budget`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", STATE_BAR[state])}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <div className="text-2xs text-muted-foreground tabular-nums">
        {money(spentUsd)} of {money(budget.limitUsd)} ({Math.round(percent)}%)
      </div>
    </div>
  );
}

/** Daily and monthly spend alerts, globally or per project, raised as inbox items. */
export function BudgetsPanel() {
  const budgets = useBudgets();
  const settings = useUsageSettings();
  const save = useSaveUsageSettings();
  const projects = useSnapshotData((s) => s.projects, []);
  const [adding, setAdding] = useState(false);
  const [projectId, setProjectId] = useState("all");
  const [period, setPeriod] = useState<UsageBudget["period"]>("daily");
  const [limit, setLimit] = useState("25");
  const [warn, setWarn] = useState("80");

  const current: UsageSettings | undefined = settings.data?.settings;
  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? "Deleted project") : "All projects";

  const persist = (next: UsageSettings, message: string) =>
    save.mutate(next, {
      onSuccess: () => toast.success(message),
      onError: (e) => toast.error(e.message),
    });

  const add = () => {
    if (!current) return;
    const limitUsd = Number(limit);
    const warnAtPercent = Math.round(Number(warn));
    if (!(limitUsd > 0) || !(warnAtPercent >= 1 && warnAtPercent <= 100)) {
      toast.error("Enter a limit above $0 and an alert level between 1 and 100%");
      return;
    }
    const budget: UsageBudget = {
      id: `budget-${Date.now().toString(36)}`,
      projectId: projectId === "all" ? null : projectId,
      period,
      limitUsd,
      warnAtPercent,
      enabled: true,
    };
    persist({ ...current, budgets: [...current.budgets, budget] }, "Budget added");
    setAdding(false);
  };

  const list = budgets.data?.budgets ?? [];
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <BellRing className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Budgets and alerts</h3>
        {!adding && (
          <Button
            variant="outline"
            size="xs"
            className="ml-auto"
            onClick={() => setAdding(true)}
            disabled={!current}
          >
            <Plus /> Add budget
          </Button>
        )}
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">
        Crossing the alert level or the limit puts an item in your inbox and sends a notification.
        Factory limits enforce the same figures.
      </p>
      {list.length === 0 && !adding && (
        <p className="py-4 text-xs text-muted-foreground">No budgets yet.</p>
      )}
      <div className="divide-y divide-border">
        {list.map((s) => (
          <BudgetRow
            key={s.budget.id}
            status={s}
            scope={projectName(s.budget.projectId)}
            onDelete={() =>
              current &&
              persist(
                { ...current, budgets: current.budgets.filter((b) => b.id !== s.budget.id) },
                "Budget removed",
              )
            }
          />
        ))}
      </div>
      {adding && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger size="sm" aria-label="Scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as UsageBudget["period"])}>
            <SelectTrigger size="sm" aria-label="Period" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Per day</SelectItem>
              <SelectItem value="monthly">Per month</SelectItem>
            </SelectContent>
          </Select>
          <Input
            aria-label="Limit in USD"
            inputMode="decimal"
            className="h-7"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Limit $"
          />
          <Input
            aria-label="Alert at percent"
            inputMode="numeric"
            className="h-7"
            value={warn}
            onChange={(e) => setWarn(e.target.value)}
            placeholder="Alert %"
          />
          <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={add} disabled={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
