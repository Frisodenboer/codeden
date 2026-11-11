import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClock, Check, ChevronDown, ChevronRight, ListTodo, Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { ageShort, until } from "@/lib/format";
import { usePlanner, usePlannerActions } from "@/lib/planner";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "codebench.followUps.collapsed";

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

const ADDED_BY = { orchestrator: "Orchestrator", pm: "PM", agent: "Agent", you: "You" } as const;

/**
 * Follow-ups: what still needs doing. "For you" fills itself from the agents' `add_follow_up`
 * (and anything you add); tick items off for a green check, remove them with ×. "Agents will"
 * lists the check-ins the orchestrator and PMs scheduled for themselves.
 */
export function FollowUpsCard({ className }: { className?: string }) {
  const client = useClient();
  const projects = useSnapshotData((s) => s.projects, []);
  const planner = usePlanner();
  const { addFollowUp, setFollowUpDone, deleteFollowUp } = usePlannerActions();
  const scheduled = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => client.getScheduled(),
    refetchInterval: 60_000,
  });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [title, setTitle] = useState("");
  const nameOf = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? "Project") : null;

  const items = [...(planner.data?.followUps ?? [])].sort((a, b) => {
    // Open first (newest first), then done (most recently done first).
    if (!a.doneAt !== !b.doneAt) return a.doneAt ? 1 : -1;
    return (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt);
  });
  const open = items.filter((f) => !f.doneAt).length;
  const wakeups = scheduled.data?.wakeups ?? [];

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    addFollowUp.mutate({ title: t });
    setTitle("");
  };

  return (
    <aside
      aria-label="Follow-ups"
      className={cn(
        "w-full rounded-xl border border-border bg-card/90 shadow-sm backdrop-blur",
        className,
      )}
    >
      <button
        type="button"
        onClick={() =>
          setCollapsed((v) => {
            writeCollapsed(!v);
            return !v;
          })
        }
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] font-medium"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
        <ListTodo className="size-3.5 text-primary" />
        Follow-ups
        {open > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 text-3xs font-medium text-primary">
            {open}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="space-y-2 border-t border-border p-2">
          <div>
            <p className="px-1 pb-1 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
              For you
            </p>
            {items.length === 0 ? (
              <p className="px-1 py-1 text-xs text-muted-foreground">
                Nothing to do. When an agent asks you to do something, it lands here.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {items.map((f) => {
                  const done = Boolean(f.doneAt);
                  const where = nameOf(f.projectId);
                  return (
                    <li
                      key={f.id}
                      className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-accent/60"
                      title={f.detail || f.title}
                    >
                      <button
                        type="button"
                        aria-pressed={done}
                        aria-label={
                          done ? `Mark ${f.title} as not done` : `Mark ${f.title} as done`
                        }
                        onClick={() =>
                          setFollowUpDone.mutate(
                            { id: f.id, done: !done },
                            {
                              onSuccess: () => {
                                if (!done && f.sessionId)
                                  toast.success("Done, and the chat was told");
                              },
                            },
                          )
                        }
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                          done
                            ? "border-status-done bg-status-done text-white"
                            : "border-border hover:border-primary",
                        )}
                      >
                        {done && <Check className="size-3" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-xs",
                            done && "text-muted-foreground line-through",
                          )}
                        >
                          {f.title}
                        </span>
                        {f.detail && !done && (
                          <span className="line-clamp-2 block text-2xs text-muted-foreground">
                            {f.detail}
                          </span>
                        )}
                        <span className="block truncate text-2xs text-muted-foreground/80">
                          {ADDED_BY[f.addedBy]}
                          {where ? ` · ${where}` : ""} · {ageShort(f.doneAt ?? f.createdAt)}
                          {f.sessionId && !done && (
                            <>
                              {" · "}
                              <Link
                                to="/sessions/$sessionId"
                                params={{ sessionId: f.sessionId }}
                                className="hover:text-foreground hover:underline"
                              >
                                open chat
                              </Link>
                            </>
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        title="Remove"
                        aria-label={`Remove ${f.title}`}
                        onClick={() => deleteFollowUp.mutate(f.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form onSubmit={add} className="mt-1 flex gap-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a follow-up…"
                aria-label="Add a follow-up"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/50"
              />
              <button
                type="submit"
                disabled={!title.trim()}
                title="Add"
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
            </form>
          </div>
          {wakeups.length > 0 && (
            <div>
              <p className="px-1 pb-1 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
                Agents will
              </p>
              <ul className="space-y-0.5">
                {wakeups.map((w) => (
                  <li key={w.id} className="flex items-start gap-2 px-1 py-1" title={w.note}>
                    <AlarmClock className="mt-0.5 size-3.5 shrink-0 text-teal-500" />
                    <div className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-xs">{w.note}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {until(w.at)} ·{" "}
                        {w.target === "pm"
                          ? `PM of ${nameOf(w.projectId) ?? "project"}`
                          : "Orchestrator"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
