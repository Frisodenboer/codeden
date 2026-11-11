import type {
  CalendarEvent,
  CalendarEventInput,
  Idea,
  IdeaInput,
  IdeaPatch,
  Planner,
} from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useClient } from "@/lib/api";

/** Drag type of an idea card; the value is the idea id, `text/plain` carries its text. */
export const IDEA_DRAG_TYPE = "application/x-codebench-idea";
/** Fired on `window` when an idea was dropped into a composer (`detail`: the idea id). */
export const IDEA_DROPPED_EVENT = "codebench:idea-dropped";

export const plannerKey = ["planner"];

/** The text an idea puts in the composer. */
export const ideaText = (idea: Pick<Idea, "title" | "notes">) =>
  idea.notes.trim() ? `${idea.title}\n\n${idea.notes.trim()}` : idea.title;

export function usePlanner() {
  const client = useClient();
  return useQuery({ queryKey: plannerKey, queryFn: () => client.getPlanner() });
}

export function usePlannerActions() {
  const client = useClient();
  const queryClient = useQueryClient();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: plannerKey });
  };
  const fail = (what: string) => (e: Error) => toast.error(what, { description: e.message });
  return {
    createEvent: useMutation({
      mutationFn: (input: CalendarEventInput) => client.createEvent(input),
      onSuccess: done,
      onError: fail("Couldn't save the event"),
    }),
    updateEvent: useMutation({
      mutationFn: ({ id, input }: { id: string; input: CalendarEventInput }) =>
        client.updateEvent(id, input),
      onSuccess: done,
      onError: fail("Couldn't save the event"),
    }),
    deleteEvent: useMutation({
      mutationFn: (id: string) => client.deleteEvent(id),
      onSuccess: done,
      onError: fail("Couldn't delete the event"),
    }),
    createIdea: useMutation({
      mutationFn: (input: IdeaInput) => client.createIdea(input),
      onSuccess: done,
      onError: fail("Couldn't add the idea"),
    }),
    updateIdea: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: IdeaPatch }) => client.updateIdea(id, patch),
      onMutate: async ({ id, patch }) => {
        // Move the card right away; the server answer confirms it.
        await queryClient.cancelQueries({ queryKey: plannerKey });
        queryClient.setQueryData<{ events: CalendarEvent[]; ideas: Idea[] }>(plannerKey, (old) =>
          old
            ? { ...old, ideas: old.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)) }
            : old,
        );
      },
      onSettled: done,
      onError: fail("Couldn't update the idea"),
    }),
    dismiss: useMutation({
      mutationFn: (id: string) => client.dismissAgendaItem(id),
      onMutate: async (id) => {
        // Hide it right away; the server answer confirms it.
        await queryClient.cancelQueries({ queryKey: plannerKey });
        queryClient.setQueryData<{ events: CalendarEvent[]; ideas: Idea[]; dismissed: string[] }>(
          plannerKey,
          (old) => (old ? { ...old, dismissed: [...old.dismissed, id] } : old),
        );
      },
      onSettled: done,
      onError: fail("Couldn't remove the item"),
    }),
    addFollowUp: useMutation({
      mutationFn: (input: { title: string; projectId?: string | null }) =>
        client.addFollowUp(input),
      onSuccess: done,
      onError: fail("Couldn't add the follow-up"),
    }),
    setFollowUpDone: useMutation({
      mutationFn: ({ id, done: isDone }: { id: string; done: boolean }) =>
        client.setFollowUpDone(id, isDone),
      onMutate: async ({ id, done: isDone }) => {
        // Tick it right away; the server answer confirms it.
        await queryClient.cancelQueries({ queryKey: plannerKey });
        queryClient.setQueryData<Planner>(plannerKey, (old) =>
          old
            ? {
                ...old,
                followUps: old.followUps.map((f) =>
                  f.id === id ? { ...f, doneAt: isDone ? new Date().toISOString() : null } : f,
                ),
              }
            : old,
        );
      },
      onSettled: done,
      onError: fail("Couldn't update the follow-up"),
    }),
    deleteFollowUp: useMutation({
      mutationFn: (id: string) => client.deleteFollowUp(id),
      onSuccess: done,
      onError: fail("Couldn't remove the follow-up"),
    }),
    deleteIdea: useMutation({
      mutationFn: (id: string) => client.deleteIdea(id),
      onSuccess: done,
      onError: fail("Couldn't delete the idea"),
    }),
  };
}

/** One showing of an event (repeats expanded). */
export interface Occurrence {
  event: CalendarEvent;
  start: Date;
}

function step(date: Date, repeat: CalendarEvent["repeat"], n: number): Date {
  const d = new Date(date);
  if (repeat === "daily") d.setDate(d.getDate() + n);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + n);
  else if (repeat === "yearly") d.setFullYear(d.getFullYear() + n);
  return d;
}

/** Every showing of `events` that starts in [from, to), repeats expanded, soonest first. */
export function occurrences(events: CalendarEvent[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of events) {
    const first = new Date(event.at);
    if (Number.isNaN(first.getTime())) continue;
    if (event.repeat === "none") {
      if (first >= from && first < to) out.push({ event, start: first });
      continue;
    }
    for (let n = 0; n < 1000; n++) {
      const start = step(first, event.repeat, n);
      if (start >= to) break;
      if (start >= from) out.push({ event, start });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Kinds of agenda items, from every source. */
export type AgendaKind = "event" | "run" | "wakeup" | "workflow" | "gbp" | "plan";

/** One colour per kind, so the agenda reads at a glance (icon, chip and left bar). */
export const AGENDA_COLORS: Record<AgendaKind, { text: string; chip: string; bar: string }> = {
  event: {
    text: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    bar: "bg-sky-500",
  },
  gbp: {
    text: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    bar: "bg-amber-500",
  },
  run: {
    text: "text-violet-600 dark:text-violet-400",
    chip: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
    bar: "bg-violet-500",
  },
  wakeup: {
    text: "text-teal-600 dark:text-teal-400",
    chip: "bg-teal-500/15 text-teal-800 dark:text-teal-200",
    bar: "bg-teal-500",
  },
  workflow: {
    text: "text-slate-500 dark:text-slate-400",
    chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    bar: "bg-slate-400",
  },
  plan: {
    text: "text-rose-600 dark:text-rose-400",
    chip: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
    bar: "bg-rose-500",
  },
};
