import { z } from "zod";

/**
 * The planner: the user's own calendar events and an idea kanban, kept in
 * `~/.codeden/planner.json`. Events show in the Scheduled window next to automation runs,
 * wake-ups and project plans; ideas can be dropped into the orchestrator's composer.
 */

export const EventRepeat = z.enum(["none", "daily", "weekly", "monthly", "yearly"]);
export type EventRepeat = z.infer<typeof EventRepeat>;

export const CalendarEvent = z.object({
  id: z.string(),
  title: z.string().min(1).max(300),
  /** Start, ISO timestamp (for all-day events: local midnight of the day). */
  at: z.string(),
  /** End, ISO timestamp; null for a point in time or a single all-day event. */
  endAt: z.string().nullable(),
  allDay: z.boolean(),
  repeat: EventRepeat,
  projectId: z.string().nullable(),
  notes: z.string().max(5000),
  createdAt: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const CalendarEventInput = z.object({
  title: z.string().trim().min(1).max(300),
  at: z.string().min(1),
  endAt: z.string().nullable().default(null),
  allDay: z.boolean().default(false),
  repeat: EventRepeat.default("none"),
  projectId: z.string().nullable().default(null),
  notes: z.string().max(5000).default(""),
});
export type CalendarEventInput = z.input<typeof CalendarEventInput>;

export const IdeaColumn = z.enum(["ideas", "next", "sent"]);
export type IdeaColumn = z.infer<typeof IdeaColumn>;

export const Idea = z.object({
  id: z.string(),
  title: z.string().min(1).max(300),
  notes: z.string().max(5000),
  column: IdeaColumn,
  /** Position within its column, ascending. */
  order: z.number(),
  projectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Idea = z.infer<typeof Idea>;

export const IdeaInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(5000).default(""),
  column: IdeaColumn.default("ideas"),
  projectId: z.string().nullable().default(null),
});
export type IdeaInput = z.input<typeof IdeaInput>;

export const IdeaPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  notes: z.string().max(5000).optional(),
  column: IdeaColumn.optional(),
  order: z.number().optional(),
  projectId: z.string().nullable().optional(),
});
export type IdeaPatch = z.infer<typeof IdeaPatch>;

export const Planner = z.object({
  events: z.array(CalendarEvent),
  ideas: z.array(Idea),
});
export type Planner = z.infer<typeof Planner>;
