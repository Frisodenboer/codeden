import type {
  CalendarEvent,
  CalendarEventInput,
  Idea,
  IdeaInput,
  IdeaPatch,
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
