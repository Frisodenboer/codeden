import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClock, CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useClient } from "@/lib/api";
import { formatAt } from "@/lib/cron";
import { until } from "@/lib/format";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";

const MAX_ITEMS = 6;
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

/**
 * A compact "what runs next" card for the top right of the orchestrator screen: the next
 * automation runs and agent wake-ups across all projects, linking to the Scheduled window.
 * Shown on wide screens only, where the left-aligned chat leaves room for it.
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
  const nameOf = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? "Project") : "Orchestrator";

  const items = [
    ...(data.data?.runs ?? [])
      .filter((r) => !r.skipped)
      .map((r) => ({
        key: `run-${r.automationId}-${r.projectId}-${r.at}`,
        at: r.at,
        icon: CalendarClock,
        title: r.name,
        where: nameOf(r.projectId),
      })),
    ...(data.data?.wakeups ?? []).map((w) => ({
      key: `wake-${w.id}`,
      at: w.at,
      icon: AlarmClock,
      title: w.note,
      where: w.target === "pm" ? `PM of ${nameOf(w.projectId)}` : "Orchestrator",
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, MAX_ITEMS);
  const total =
    (data.data?.runs.filter((r) => !r.skipped).length ?? 0) + (data.data?.wakeups.length ?? 0);

  return (
    <aside
      aria-label="Scheduled"
      className={cn(
        "w-72 rounded-xl border border-border bg-card/90 shadow-sm backdrop-blur",
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
          {total > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-3xs font-medium text-primary">
              {total}
            </span>
          )}
        </button>
        <Link to="/scheduled" className="text-2xs text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {!collapsed && (
        <div className="border-t border-border px-1.5 py-1.5">
          {data.error ? (
            <p className="px-1.5 py-1 text-xs text-status-failed">{data.error.message}</p>
          ) : data.isLoading ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((it) => (
                <li key={it.key}>
                  <Link
                    to="/scheduled"
                    className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/60"
                    title={`${it.title} · ${formatAt(it.at)}`}
                  >
                    <it.icon className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{it.title}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {until(it.at)} · {it.where}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
