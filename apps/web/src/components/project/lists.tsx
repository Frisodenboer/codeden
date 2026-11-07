import type { Automation, AutomationTrigger, ScheduledRun, Session } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock, Hand, Zap } from "lucide-react";
import { IssueBadge, PrBadge, ProviderMark } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";
import { ageShort, statusLabel, until } from "@/lib/format";

const startedBy = { user: "You", orchestrator: "Orchestrator", pm: "PM", automation: "Automation" };

/** All agent sessions in the project. */
export function SessionsList({ sessions }: { sessions: Session[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {sessions.map((s) => (
        <Link
          key={s.id}
          to="/sessions/$sessionId"
          params={{ sessionId: s.id }}
          className="grid grid-cols-[16px_minmax(0,1fr)_96px_110px_44px] items-center gap-3 border-b border-border px-3.5 py-2 text-[13px] transition-colors last:border-0 hover:bg-accent/40"
        >
          <StatusDot status={s.status} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{s.title ?? s.purpose}</span>
              {s.issue && <IssueBadge issue={s.issue} />}
              {s.pr && <PrBadge pr={s.pr} />}
            </span>
            <span className="block truncate font-mono text-3xs text-muted-foreground">
              {s.workKey} · {s.branch}
            </span>
          </span>
          <span className="text-2xs text-muted-foreground">{statusLabel[s.status]}</span>
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <ProviderMark provider={s.provider} /> {startedBy[s.startedBy.kind]}
          </span>
          <span className="text-right text-2xs text-muted-foreground tabular-nums">
            {ageShort(s.updatedAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human description of a trigger, e.g. "Mondays at 09:00" or "When a PR opens". */
export function describeTrigger(t: AutomationTrigger): string {
  if (t.type === "manual") return "Manual";
  if (t.type === "event") return `On ${t.event.replace(".", " ").replace("_", " ")}`;
  const [min, hour, dom, , dow] = t.expression.split(" ");
  const time =
    hour !== undefined && min !== undefined && /^\d+$/.test(hour)
      ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`
      : t.expression;
  if (dow && dow !== "*") return `${DAYS[Number(dow)] ?? dow}s at ${time}`;
  if (dom === "*") return `Daily at ${time}`;
  return t.expression;
}

const triggerIcon = { cron: Clock, event: Zap, manual: Hand };

/** Automations with on/off toggles (all off by default, §10). */
export function AutomationsList({
  automations,
  scheduled,
}: {
  automations: Automation[];
  scheduled: ScheduledRun[];
}) {
  const client = useClient();
  const toggle = useMutation({
    mutationFn: (a: { id: string; enabled: boolean }) =>
      client.setAutomationEnabled(a.id, a.enabled),
  });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {automations.map((a) => {
        const Icon = triggerIcon[a.trigger.type];
        const next = scheduled.find((r) => r.automationId === a.id && !r.skipped);
        return (
          <div
            key={a.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{a.name}</div>
              <div className="mt-0.5 truncate text-2xs text-muted-foreground">{a.description}</div>
              <div className="mt-2 flex items-center gap-1.5 text-3xs text-muted-foreground/80">
                <Icon className="size-3" />
                {describeTrigger(a.trigger)}
                {a.enabled && next && (
                  <span className="text-foreground/70">· next {until(next.at)}</span>
                )}
                <span className="ml-auto rounded bg-muted px-1.5 py-px">
                  {a.guards.overlapPolicy}
                </span>
              </div>
            </div>
            <Switch
              checked={a.enabled}
              onCheckedChange={(enabled) => toggle.mutate({ id: a.id, enabled })}
              aria-label={`Toggle ${a.name}`}
            />
          </div>
        );
      })}
    </div>
  );
}
