import type { CalendarEvent, PlannedItem, ScheduledRun, ScheduledWakeup } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  List,
  MapPin,
  NotebookPen,
  Plus,
  RefreshCw,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/bits";
import { EventDialog, type EventDialogTarget, localDay } from "@/components/planner/event-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { automationKeys } from "@/lib/automations";
import { occurrences, usePlanner } from "@/lib/planner";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";

export const scheduledKey = ["scheduled"];

type Kind = "event" | "run" | "wakeup" | "workflow" | "gbp" | "plan";

/** One thing on the calendar, whatever its source. */
interface Item {
  key: string;
  at: Date;
  kind: Kind;
  title: string;
  where: string;
  allDay?: boolean;
  detail?: string | null;
  event?: CalendarEvent;
  run?: ScheduledRun;
  wakeup?: ScheduledWakeup;
}

const KIND: Record<Kind, { label: string; icon: typeof CalendarClock; chip: string }> = {
  event: { label: "Your event", icon: CalendarDays, chip: "bg-primary/15 text-primary" },
  run: { label: "Automation", icon: CalendarClock, chip: "bg-chart-2/15 text-foreground" },
  wakeup: { label: "Agent wake-up", icon: AlarmClock, chip: "bg-muted text-foreground" },
  workflow: { label: "GitHub workflow", icon: GitBranch, chip: "bg-muted text-muted-foreground" },
  gbp: {
    label: "Google Business post",
    icon: MapPin,
    chip: "bg-status-waiting/15 text-foreground",
  },
  plan: { label: "Project plan", icon: NotebookPen, chip: "bg-accent text-foreground" },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const timeOf = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Everything scheduled, from every source, in [from, to). */
function useItems(from: Date, to: Date) {
  const client = useClient();
  const projects = useSnapshotData((s) => s.projects, []);
  const scheduled = useQuery({
    queryKey: scheduledKey,
    queryFn: () => client.getScheduled(),
    refetchInterval: 60_000,
  });
  const planner = usePlanner();
  const items = useMemo(() => {
    const nameOf = (id: string | null) =>
      id ? (projects.find((p) => p.id === id)?.name ?? "Project") : "";
    const out: Item[] = [];
    const inRange = (d: Date) => d >= from && d < to;
    for (const o of occurrences(planner.data?.events ?? [], from, to)) {
      out.push({
        key: `event-${o.event.id}-${o.start.toISOString()}`,
        at: o.start,
        kind: "event",
        title: o.event.title,
        where: nameOf(o.event.projectId),
        allDay: o.event.allDay,
        detail: o.event.notes || null,
        event: o.event,
      });
    }
    for (const r of scheduled.data?.runs ?? []) {
      const at = new Date(r.at);
      if (inRange(at))
        out.push({
          key: `run-${r.automationId}-${r.projectId}-${r.at}`,
          at,
          kind: "run",
          title: r.name,
          where: nameOf(r.projectId),
          run: r,
        });
    }
    for (const w of scheduled.data?.wakeups ?? []) {
      const at = new Date(w.at);
      if (inRange(at))
        out.push({
          key: `wake-${w.id}`,
          at,
          kind: "wakeup",
          title: w.note,
          where: w.target === "pm" ? `PM of ${nameOf(w.projectId)}` : "Orchestrator",
          wakeup: w,
        });
    }
    for (const p of scheduled.data?.planned ?? ([] as PlannedItem[])) {
      const at = new Date(p.at);
      if (inRange(at))
        out.push({
          key: p.id,
          at,
          kind: p.source,
          title: p.title,
          where: nameOf(p.projectId),
          detail: p.detail,
        });
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [planner.data, scheduled.data, from, to, projects]);

  return {
    items,
    isLoading: scheduled.isLoading || planner.isLoading,
    isFetching: scheduled.isFetching || planner.isFetching,
    error: scheduled.error ?? planner.error,
  };
}

function RunActions({ run }: { run: ScheduledRun }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const skip = useMutation({
    mutationFn: () =>
      run.skipped
        ? client.automations.unskipNext(run.automationId, run.projectId ?? "")
        : client.automations.skipNext(run.automationId, run.projectId ?? ""),
    onSuccess: () => {
      toast.success(run.skipped ? "This run will happen again" : "Run skipped");
      void queryClient.invalidateQueries({ queryKey: scheduledKey });
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
    onError: (e) => toast.error("Couldn't change the run", { description: e.message }),
  });
  if (!run.projectId) return null;
  return (
    <Button size="sm" variant="ghost" disabled={skip.isPending} onClick={() => skip.mutate()}>
      {run.skipped ? <Undo2 /> : <SkipForward />}
      <span className="hidden sm:inline">{run.skipped ? "Unskip" : "Skip"}</span>
    </Button>
  );
}

function WakeupActions({ wakeup }: { wakeup: ScheduledWakeup }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => client.cancelWakeup(wakeup.id, wakeup.target, wakeup.projectId),
    onSuccess: () => {
      toast.success("Wake-up cancelled");
      void queryClient.invalidateQueries({ queryKey: scheduledKey });
    },
    onError: (e) => toast.error("Couldn't cancel the wake-up", { description: e.message }),
  });
  return (
    <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
      <X />
      <span className="hidden sm:inline">Cancel</span>
    </Button>
  );
}

function ItemRow({ item, onEdit }: { item: Item; onEdit: (e: CalendarEvent) => void }) {
  const k = KIND[item.kind];
  const title = item.run?.projectId ? (
    <Link
      to="/projects/$projectId/automations/$automationId"
      params={{ projectId: item.run.projectId, automationId: item.run.automationId }}
      className={cn("truncate hover:underline", item.run.skipped && "line-through")}
    >
      {item.title}
    </Link>
  ) : item.event ? (
    <button
      type="button"
      onClick={() => item.event && onEdit(item.event)}
      className="truncate text-left hover:underline"
    >
      {item.title}
    </button>
  ) : (
    <span className="truncate">{item.title}</span>
  );
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2",
        item.run?.skipped && "opacity-60",
      )}
      title={item.detail ?? undefined}
    >
      <k.icon className="size-4 shrink-0 text-primary/80" />
      <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
        {item.allDay ? "All day" : timeOf(item.at)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col text-[13px]">
        {title}
        <span className="truncate text-xs text-muted-foreground">
          {k.label}
          {item.where ? ` · ${item.where}` : ""}
        </span>
      </div>
      {item.run && <RunActions run={item.run} />}
      {item.wakeup && <WakeupActions wakeup={item.wakeup} />}
    </li>
  );
}

function MonthView({
  month,
  items,
  onNewOn,
  onEdit,
}: {
  month: Date;
  items: Item[];
  onNewOn: (day: Date) => void;
  onEdit: (e: CalendarEvent) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = localDay(new Date());
  const byDay = new Map<string, Item[]>();
  for (const it of items) {
    const k = localDay(it.at);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-7 overflow-hidden rounded-lg border border-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="border-b border-border bg-card/60 px-2 py-1 text-2xs font-medium text-muted-foreground uppercase"
          >
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = localDay(day);
          const list = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              className={cn(
                "group min-h-24 border-b border-l border-border p-1 first:border-l-0 [&:nth-child(7n+1)]:border-l-0",
                !inMonth && "bg-muted/20 text-muted-foreground/60",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-2xs tabular-nums",
                    key === today && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
                <button
                  type="button"
                  title="New event on this day"
                  aria-label={`New event on ${key}`}
                  onClick={() => onNewOn(day)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground [@media(hover:none)]:opacity-100"
                >
                  <Plus className="size-3" />
                </button>
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {list.slice(0, 4).map((it) => {
                  const k = KIND[it.kind];
                  const label = `${it.allDay ? "" : `${timeOf(it.at)} `}${it.title}`;
                  return (
                    <li key={it.key}>
                      <button
                        type="button"
                        onClick={() => it.event && onEdit(it.event)}
                        title={`${k.label}${it.where ? ` · ${it.where}` : ""}\n${label}${it.detail ? `\n\n${it.detail}` : ""}`}
                        className={cn(
                          "flex w-full items-center gap-1 truncate rounded px-1 py-px text-left text-2xs",
                          k.chip,
                          !it.event && "cursor-default",
                          it.run?.skipped && "line-through opacity-60",
                        )}
                      >
                        <k.icon className="size-2.5 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    </li>
                  );
                })}
                {list.length > 4 && (
                  <li
                    className="px-1 text-2xs text-muted-foreground"
                    title={list
                      .slice(4)
                      .map((it) => `${timeOf(it.at)} ${it.title}`)
                      .join("\n")}
                  >
                    +{list.length - 4} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ items, onEdit }: { items: Item[]; onEdit: (e: CalendarEvent) => void }) {
  if (items.length === 0)
    return (
      <EmptyState icon={<CalendarClock />} title="Nothing planned">
        Your events, automation runs, agent wake-ups, GitHub workflows, Google Business posts and
        project plans show up here.
      </EmptyState>
    );
  const groups: { day: string; label: string; items: Item[] }[] = [];
  for (const it of items) {
    const day = localDay(it.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(it);
    else
      groups.push({
        day,
        label: it.at.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
        items: [it],
      });
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-1.5 text-xs font-medium text-muted-foreground first-letter:uppercase">
            {g.label}
          </h2>
          <ul className="space-y-1.5">
            {g.items.map((it) => (
              <ItemRow key={it.key} item={it} onEdit={onEdit} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The calendar: the user's own events plus everything CodeBench and the projects have planned
 * (automation runs, agent wake-ups, scheduled GitHub workflows, Google Business posts, plan
 * files), as a month grid or an agenda list.
 */
export function ScheduledPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"month" | "list">("month");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dialog, setDialog] = useState<EventDialogTarget>(null);

  const [from, to] = useMemo(() => {
    if (view === "list") {
      const start = startOfDay(new Date());
      return [start, new Date(start.getTime() + 90 * DAY_MS)];
    }
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    return [gridStart, addDays(gridStart, 42)];
  }, [view, month]);
  const { items, isLoading, isFetching, error } = useItems(from, to);
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<CalendarClock />}
        title="Scheduled"
        meta={
          view === "month"
            ? month.toLocaleDateString([], { month: "long", year: "numeric" })
            : "The next 90 days"
        }
        actions={
          <>
            {view === "month" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => shift(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const n = new Date();
                    setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
                  }}
                >
                  Today
                </Button>
                <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month">
                  <ChevronRight />
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setView((v) => (v === "month" ? "list" : "month"))}
            >
              {view === "month" ? <List /> : <CalendarDays />}
              {view === "month" ? "List" : "Month"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Refresh"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: scheduledKey });
                void queryClient.invalidateQueries({ queryKey: ["planner"] });
              }}
            >
              <RefreshCw className={cn(isFetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={() => setDialog({ day: new Date() })}>
              <Plus /> New event
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="w-full px-4 py-5 sm:px-6">
          {error ? (
            <div className="text-sm text-status-failed">{error.message}</div>
          ) : isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : view === "month" ? (
            <MonthView
              month={month}
              items={items}
              onNewOn={(day) => setDialog({ day })}
              onEdit={(event) => setDialog({ event })}
            />
          ) : (
            <div className="mr-auto max-w-[52rem]">
              <ListView items={items} onEdit={(event) => setDialog({ event })} />
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
            {(Object.keys(KIND) as Kind[]).map((k) => {
              const K = KIND[k];
              return (
                <span key={k} className="flex items-center gap-1">
                  <span className={cn("flex size-3.5 items-center justify-center rounded", K.chip)}>
                    <K.icon className="size-2.5" />
                  </span>
                  {K.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <EventDialog target={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
