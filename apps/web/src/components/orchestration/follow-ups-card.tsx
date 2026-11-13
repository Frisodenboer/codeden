import type { FollowUp } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClock, Check, ChevronDown, ChevronRight, ListTodo, Pin, Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { ageShort, until } from "@/lib/format";
import { usePlanner, usePlannerActions } from "@/lib/planner";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "codebench.followUps.collapsed";
const PINNED_KEY = "codebench.followUps.pinned";

function readPinned(): string | null {
  try {
    return localStorage.getItem(PINNED_KEY);
  } catch {
    return null;
  }
}

function writePinned(id: string | null) {
  try {
    if (id) localStorage.setItem(PINNED_KEY, id);
    else localStorage.removeItem(PINNED_KEY);
  } catch {
    // Storage can be unavailable; the pin just won't survive a reload.
  }
}

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
  /** The follow-up shown as a big sticky note at the top right of the screen. */
  const [pinnedId, setPinnedId] = useState<string | null>(readPinned);
  const pin = (id: string | null) => {
    writePinned(id);
    setPinnedId(id);
  };
  const nameOf = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? "Project") : null;

  const items = [...(planner.data?.followUps ?? [])].sort((a, b) => {
    // Open first (newest first), then done (most recently done first).
    if (!a.doneAt !== !b.doneAt) return a.doneAt ? 1 : -1;
    return (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt);
  });
  const open = items.filter((f) => !f.doneAt).length;
  const pinned = items.find((f) => f.id === pinnedId) ?? null;
  const toggleDone = (f: FollowUp) => {
    const done = Boolean(f.doneAt);
    setFollowUpDone.mutate(
      { id: f.id, done: !done },
      {
        onSuccess: () => {
          if (!done && f.sessionId) toast.success("Done, and the chat was told");
        },
      },
    );
  };
  const wakeups = scheduled.data?.wakeups ?? [];

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    addFollowUp.mutate({ title: t });
    setTitle("");
  };

  return (
    <>
      {pinned &&
        createPortal(
          <StickyFollowUp
            followUp={pinned}
            where={nameOf(pinned.projectId)}
            onToggleDone={() => toggleDone(pinned)}
            onClose={() => pin(null)}
          />,
          document.body,
        )}
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
                <ul className="space-y-1.5">
                  {items.map((f) => {
                    const done = Boolean(f.doneAt);
                    const where = nameOf(f.projectId);
                    return (
                      <li
                        key={f.id}
                        className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-accent/60"
                      >
                        <button
                          type="button"
                          aria-pressed={done}
                          aria-label={
                            done ? `Mark ${f.title} as not done` : `Mark ${f.title} as done`
                          }
                          onClick={() => toggleDone(f)}
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
                          <button
                            type="button"
                            onClick={() => pin(pinnedId === f.id ? null : f.id)}
                            aria-pressed={pinnedId === f.id}
                            title="Open as a sticky note at the top right"
                            className="block w-full cursor-pointer text-left"
                          >
                            <span
                              className={cn(
                                "line-clamp-2 text-xs font-medium",
                                done && "font-normal text-muted-foreground line-through",
                                pinnedId === f.id && "text-primary",
                              )}
                            >
                              {f.title}
                            </span>
                            {f.detail && !done && (
                              <span className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground hover:text-foreground/80">
                                {f.detail}
                              </span>
                            )}
                          </button>
                          <span className="mt-0.5 block truncate text-3xs text-muted-foreground/60">
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
                          onClick={() => {
                            if (pinnedId === f.id) pin(null);
                            deleteFollowUp.mutate(f.id);
                          }}
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
                        <span className="line-clamp-2 text-xs">{w.note}</span>
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
    </>
  );
}

/**
 * One follow-up, big and readable, pinned to the top right of the screen over everything else
 * until it's closed. Opened by clicking a follow-up in the card.
 */
function StickyFollowUp({
  followUp: f,
  where,
  onToggleDone,
  onClose,
}: {
  followUp: FollowUp;
  where: string | null;
  onToggleDone: () => void;
  onClose: () => void;
}) {
  const done = Boolean(f.doneAt);
  return (
    <section
      aria-label="Pinned follow-up"
      className="fixed top-14 right-4 z-40 flex max-h-[calc(100vh-5rem)] w-[min(32rem,calc(100vw-2rem))] flex-col rounded-xl border border-primary/40 bg-popover shadow-2xl animate-rise"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        <Pin className="size-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">Follow-up</span>
        <span className="truncate">
          {ADDED_BY[f.addedBy]}
          {where ? ` · ${where}` : ""} · {ageShort(f.doneAt ?? f.createdAt)}
        </span>
        <button
          type="button"
          title="Close"
          aria-label="Close pinned follow-up"
          onClick={onClose}
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">
        <h2
          className={cn(
            "text-base font-semibold",
            done && "font-normal text-muted-foreground line-through",
          )}
        >
          {f.title}
        </h2>
        {f.detail && (
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
            {f.detail}
          </p>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleDone}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
            done
              ? "border border-border hover:bg-muted"
              : "bg-status-done text-white hover:bg-status-done/90",
          )}
        >
          <Check className="size-3.5" /> {done ? "Not done" : "Done"}
        </button>
        {f.sessionId && (
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: f.sessionId }}
            className="flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
          >
            Open chat
          </Link>
        )}
      </footer>
    </section>
  );
}
