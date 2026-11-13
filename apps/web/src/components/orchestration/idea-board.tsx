import type { Idea, IdeaColumn } from "@codeden/contracts";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Lightbulb,
  Plus,
  Trash2,
} from "lucide-react";
import { type DragEvent, type FormEvent, useEffect, useState } from "react";
import { roleDraftKey, useRoleSession } from "@/components/orchestration/role-chat";
import {
  IDEA_DRAG_TYPE,
  IDEA_DROPPED_EVENT,
  ideaText,
  usePlanner,
  usePlannerActions,
} from "@/lib/planner";
import { cn } from "@/lib/utils";
import { useComposerStore } from "@/stores/composer";

const COLUMNS: { id: IdeaColumn; label: string }[] = [
  { id: "ideas", label: "Ideas" },
  { id: "next", label: "Next" },
  { id: "sent", label: "Sent" },
];
const COLLAPSED_KEY = "codebench.ideaBoard.collapsed";

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
    // Storage can be unavailable; the board just won't remember.
  }
}

/**
 * The idea kanban under the Scheduled card: Ideas → Next → Sent. Drag cards between columns,
 * or drag one into the orchestrator's composer (or use → Orchestrator) to start on it; a used
 * idea moves to Sent.
 */
export function IdeaBoard({
  className,
  projectId = null,
}: {
  className?: string;
  /** On a PM screen: the PM whose prompt box ideas go to; null for the orchestrator. */
  projectId?: string | null;
}) {
  const planner = usePlanner();
  const { createIdea, updateIdea, deleteIdea } = usePlannerActions();
  const role = projectId ? "pm" : "orchestrator";
  const target = useRoleSession(role, projectId);
  const draftKey = target?.id ?? roleDraftKey(role, projectId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [title, setTitle] = useState("");
  const [over, setOver] = useState<IdeaColumn | null>(null);
  const [showSent, setShowSent] = useState(false);
  const ideas = planner.data?.ideas ?? [];

  // An idea dropped into a composer counts as sent.
  useEffect(() => {
    const onDropped = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) updateIdea.mutate({ id, patch: { column: "sent" } });
    };
    window.addEventListener(IDEA_DROPPED_EVENT, onDropped);
    return () => window.removeEventListener(IDEA_DROPPED_EVENT, onDropped);
  }, [updateIdea.mutate]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    createIdea.mutate({ title: t });
    setTitle("");
  };

  const sendToOrchestrator = (idea: Idea) => {
    const store = useComposerStore.getState();
    store.setText(draftKey, ideaText(idea));
    store.focus();
    updateIdea.mutate({ id: idea.id, patch: { column: "sent" } });
  };

  const dropOn = (column: IdeaColumn) => (e: DragEvent) => {
    const id = e.dataTransfer.getData(IDEA_DRAG_TYPE);
    setOver(null);
    if (!id) return;
    e.preventDefault();
    const top = Math.min(0, ...ideas.filter((i) => i.column === column).map((i) => i.order));
    updateIdea.mutate({ id, patch: { column, order: top - 1 } });
  };

  return (
    <aside
      aria-label="Idea board"
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
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[15px] font-medium"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
        <Lightbulb className="size-3.5 text-primary" />
        Ideas
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          drag into the chat
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-2 border-t border-border p-2">
          <form onSubmit={add} className="flex gap-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New idea…"
              aria-label="New idea"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[13.5px] outline-none focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              title="Add idea"
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Plus className="size-3.5" />
            </button>
          </form>
          {planner.error && (
            <p className="text-[13.5px] text-status-failed">{planner.error.message}</p>
          )}
          {COLUMNS.map((col) => {
            const cards = ideas
              .filter((i) => i.column === col.id)
              .sort((a, b) => a.order - b.order);
            const hidden = col.id === "sent" && !showSent;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: drop zone for dragged idea cards; every card also has buttons.
              <section
                key={col.id}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(IDEA_DRAG_TYPE)) return;
                  e.preventDefault();
                  setOver(col.id);
                }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={dropOn(col.id)}
                className={cn(
                  "rounded-lg border border-transparent bg-background/40 p-1.5",
                  over === col.id && "border-dashed border-primary/60 bg-primary/[0.05]",
                )}
              >
                <button
                  type="button"
                  disabled={col.id !== "sent"}
                  onClick={() => setShowSent((v) => !v)}
                  className="flex w-full items-center gap-1 px-1 pb-1 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {col.label}
                  <span className="font-normal">({cards.length})</span>
                  {col.id === "sent" && (
                    <span className="ml-auto font-normal normal-case">
                      {hidden ? "show" : "hide"}
                    </span>
                  )}
                </button>
                {!hidden && (
                  <ul className="space-y-1">
                    {cards.length === 0 && (
                      <li className="px-1 py-1 text-xs text-muted-foreground/70">
                        Drop ideas here
                      </li>
                    )}
                    {cards.map((idea) => (
                      <li
                        key={idea.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(IDEA_DRAG_TYPE, idea.id);
                          e.dataTransfer.setData("text/plain", ideaText(idea));
                          e.dataTransfer.effectAllowed = "copyMove";
                        }}
                        className={cn(
                          "group flex cursor-grab items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 active:cursor-grabbing",
                          col.id === "sent" && "opacity-60",
                        )}
                        title={ideaText(idea)}
                      >
                        <GripVertical className="size-3 shrink-0 text-muted-foreground/60" />
                        <span className="min-w-0 flex-1 truncate text-[13.5px]">{idea.title}</span>
                        <button
                          type="button"
                          title={
                            projectId
                              ? "Put it in the PM's prompt box"
                              : "Put it in the orchestrator's prompt box"
                          }
                          aria-label={`Send ${idea.title} to the ${projectId ? "PM" : "orchestrator"}`}
                          onClick={() => sendToOrchestrator(idea)}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-primary focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                        >
                          <ArrowRight className="size-3" />
                        </button>
                        <button
                          type="button"
                          title="Delete idea"
                          aria-label={`Delete ${idea.title}`}
                          onClick={() => deleteIdea.mutate(idea.id)}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-status-failed focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
