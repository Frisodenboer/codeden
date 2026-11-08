import type { AutomationListItem } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { Clock, Hand, Pause, Play, Zap } from "lucide-react";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { stateIn, switchValue } from "@/lib/automations";
import { ago, until } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OriginBadges } from "./detail-actions";
import { describeTrigger, RUN_STATUS, SKIP_REASON } from "./meta";
import type { useAutomationActions } from "./use-automation-actions";

export const triggerIcon = { cron: Clock, event: Zap, manual: Hand };

/** One automation in a project: trigger, next and last run, run now and its switch (§10). */
export function AutomationRow({
  item,
  projectId,
  actions,
  compact = false,
}: {
  item: AutomationListItem;
  projectId: string;
  actions: ReturnType<typeof useAutomationActions>;
  compact?: boolean;
}) {
  const a = item.automation;
  const state = stateIn(item, projectId);
  const on = switchValue(item, projectId);
  const Icon = triggerIcon[a.trigger.type];
  const last = item.lastRun;
  const blocked = on && state && !state.enabled;
  return (
    <div
      className="group flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-0 hover:bg-accent/30"
      data-testid="automation-row"
      data-automation={a.id}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground",
          state?.enabled && "border-primary/25 bg-primary/8 text-primary",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to="/projects/$projectId/automations/$automationId"
            params={{ projectId, automationId: a.id }}
            className="truncate text-[13px] font-medium hover:underline"
          >
            {a.name}
          </Link>
          <OriginBadges item={item} />
          {state?.paused && (
            <span className="rounded bg-status-waiting/12 px-1.5 py-px text-3xs text-status-waiting">
              Paused
            </span>
          )}
          {state?.enabledOverride != null && (
            <span className="rounded bg-muted px-1.5 py-px text-3xs text-muted-foreground">
              Project override
            </span>
          )}
        </div>
        {!compact && a.description && (
          <p className="truncate text-2xs text-muted-foreground">{a.description}</p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-muted-foreground/90">
          <span>{describeTrigger(a.trigger)}</span>
          {state?.nextRunAt && (
            <span className="text-foreground/70">
              · next {until(state.nextRunAt)}
              {state.skipNextAt === state.nextRunAt && " (skipped)"}
            </span>
          )}
          {blocked && <span className="text-status-waiting">· off for this project</span>}
          {last && (
            <span className="flex items-center gap-1" title={last.purpose}>
              · <StatusDot tone={RUN_STATUS[last.status].tone} className="size-1.5" />
              {RUN_STATUS[last.status].label}
              {last.skipReason && ` (${SKIP_REASON[last.skipReason].toLowerCase()})`}{" "}
              {ago(last.startedAt)}
            </span>
          )}
        </div>
      </div>
      {!compact && state?.enabled && a.trigger.type !== "manual" && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
          aria-label={state.paused ? `Resume ${a.name}` : `Pause ${a.name}`}
          onClick={() => actions.pause.mutate({ id: a.id, paused: !state.paused })}
        >
          {state.paused ? <Play /> : <Pause />}
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground"
        disabled={actions.run.isPending || a.action.type === "triage"}
        title={a.action.type === "triage" ? "Triage runs when an issue opens" : "Run now"}
        onClick={() => actions.run.mutate({ id: a.id, name: a.name })}
      >
        <Play /> Run
      </Button>
      <Switch
        checked={on}
        onCheckedChange={(enabled) => actions.toggle.mutate({ item, enabled })}
        aria-label={`Enable ${a.name}`}
      />
    </div>
  );
}
