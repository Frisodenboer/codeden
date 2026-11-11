import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  MapPin,
  NotebookPen,
  X,
} from "lucide-react";
import { useState } from "react";
import { useClient } from "@/lib/api";
import { formatAt } from "@/lib/cron";
import { until } from "@/lib/format";
import {
  AGENDA_COLORS,
  type AgendaKind,
  occurrences,
  usePlanner,
  usePlannerActions,
} from "@/lib/planner";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";

const MAX_UPCOMING = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const COLLAPSED_KEY = "codebench.scheduledCard.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Storage can be unavailable; the card just won't remember.
  }
}

interface Row {
  key: string;
  kind: AgendaKind;
  at: string;
  icon: typeof CalendarClock;
  title: string;
  where: string;
  /** Set on finished items: true = done (green tick), false = failed. */
  ok?: boolean;
}

const sourceIcon = (s: string) =>
  s === "gbp" ? MapPin : s === "workflow" ? GitBranch : s === "run" ? CalendarClock : NotebookPen;

/**
 * A compact agenda for the top right of the orchestrator screen: what finished recently (with a
 * green tick, kept until you remove it) and what runs next, across all projects and your own
 * events. Links to the Scheduled window.
 */
export function ScheduledCard({ className }: { className?: string }) {
  const client = useClient();
  const projects = useSnapshotData((s) => s.projects, []);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const data = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => client.getScheduled(),
    refetchInterval: 60_000,
  });
  const planner = usePlanner();
  const { dismiss } = usePlannerActions();
  const nameOf = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? "Project") : "Orchestrator";

  const now = new Date();
  const dismissed = new Set(planner.data?.dismissed ?? []);
  const events = planner.data?.events ?? [];
  const eventRow = (o: ReturnType<typeof occurrences>[number], ok?: boolean): Row => ({
    key: `event:${o.event.id}:${o.start.toISOString()}`,
    at: o.start.toISOString(),
    kind: "event",
    icon: CalendarDays,
    title: o.event.title,
    where: o.event.projectId ? nameOf(o.event.projectId) : "Your event",
    ...(ok === undefined ? {} : { ok }),
  });

  const done: Row[] = [
    ...occurrences(events, new Date(now.getTime() - 30 * DAY_MS), now).map((o) =>
      eventRow(o, true),
    ),
    ...(data.data?.done ?? []).map((d) => ({
      key: d.id,
      at: d.at,
      kind: d.source,
      icon: sourceIcon(d.source),
      title: d.title,
      where: nameOf(d.projectId),
      ok: d.ok,
    })),
  ]
    .filter((r) => !dismissed.has(r.key))
    .sort((a, b) => b.at.localeCompare(a.at));

  const upcoming: Row[] = [
    ...occurrences(events, now, new Date(now.getTime() + 7 * DAY_MS)).map((o) => eventRow(o)),
    ...(data.data?.planned ?? []).map((p) => ({
      key: p.id,
      at: p.at,
      kind: p.source,
      icon: sourceIcon(p.source),
      title: p.title,
      where: nameOf(p.projectId),
    })),
    ...(data.data?.runs ?? [])
      .filter((r) => !r.skipped)
      .map((r) => ({
        key: `run-${r.automationId}-${r.projectId}-${r.at}`,
        at: r.at,
        kind: "run" as const,
        icon: CalendarClock,
        title: r.name,
        where: nameOf(r.projectId),
      })),
    ...(data.data?.wakeups ?? []).map((w) => ({
      key: `wake-${w.id}`,
      at: w.at,
      kind: "wakeup" as const,
      icon: AlarmClock,
      title: w.note,
      where: w.target === "pm" ? `PM of ${nameOf(w.projectId)}` : "Orchestrator",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const row = (r: Row) => (
    <li
      key={r.key}
      className="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/60"
    >
      {r.ok === true ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-status-done" aria-label="Done" />
      ) : r.ok === false ? (
        <X className="mt-0.5 size-3.5 shrink-0 text-status-failed" aria-label="Failed" />
      ) : (
        <r.icon className={cn("mt-0.5 size-3.5 shrink-0", AGENDA_COLORS[r.kind].text)} />
      )}
      <Link to="/scheduled" className="min-w-0 flex-1" title={`${r.title} · ${formatAt(r.at)}`}>
        <span
          className={cn("block truncate text-xs", r.ok !== undefined && "text-muted-foreground")}
        >
          {r.title}
        </span>
        <span className="block truncate text-2xs text-muted-foreground">
          {r.ok === undefined ? until(r.at) : formatAt(r.at)} · {r.where}
          {r.ok === false && " · failed"}
        </span>
      </Link>
      {r.ok !== undefined && (
        <button
          type="button"
          title="Remove from the agenda"
          aria-label={`Remove ${r.title}`}
          onClick={() => dismiss.mutate(r.key)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </li>
  );

  return (
    <aside
      aria-label="Scheduled"
      className={cn(
        "w-full rounded-xl border border-border bg-card/90 shadow-sm backdrop-blur",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setCollapsed((v) => {
              writeCollapsed(!v);
              return !v;
            });
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
          <CalendarClock className="size-3.5 text-primary" />
          Scheduled
          {upcoming.length > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-3xs font-medium text-primary">
              {upcoming.length}
            </span>
          )}
          {done.length > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-status-done/15 px-1.5 text-3xs font-medium text-status-done">
              <Check className="size-2.5" />
              {done.length}
            </span>
          )}
        </button>
        <Link to="/scheduled" className="text-2xs text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {!collapsed && (
        <div className="space-y-1.5 border-t border-border px-1.5 py-1.5">
          {data.error ? (
            <p className="px-1.5 py-1 text-xs text-status-failed">{data.error.message}</p>
          ) : data.isLoading ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              {done.length > 0 && (
                <div>
                  <p className="px-1.5 pt-0.5 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
                    Done
                  </p>
                  <ul className="space-y-0.5">{done.map(row)}</ul>
                </div>
              )}
              <div>
                {done.length > 0 && (
                  <p className="px-1.5 pt-0.5 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
                    Next
                  </p>
                )}
                {upcoming.length === 0 ? (
                  <p className="px-1.5 py-1 text-xs text-muted-foreground">Nothing scheduled.</p>
                ) : (
                  <ul className="space-y-0.5">{upcoming.slice(0, MAX_UPCOMING).map(row)}</ul>
                )}
                {upcoming.length > MAX_UPCOMING && (
                  <Link
                    to="/scheduled"
                    className="block px-1.5 pt-0.5 text-2xs text-muted-foreground hover:text-foreground"
                  >
                    +{upcoming.length - MAX_UPCOMING} more
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
