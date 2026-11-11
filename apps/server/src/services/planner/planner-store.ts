import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type CalendarEvent,
  CalendarEventInput,
  type Idea,
  IdeaInput,
  type IdeaPatch,
  Planner,
} from "@codeden/contracts";
import { badRequest, notFound } from "../errors";

/**
 * The user's calendar events and idea kanban in one JSON file (`~/.codeden/planner.json`).
 * Small and personal, so it is read on demand and written atomically (temp file + rename).
 */
export class PlannerStore {
  constructor(private readonly file: string) {}

  read(): Planner {
    if (!existsSync(this.file)) return { events: [], ideas: [], dismissed: [] };
    try {
      return Planner.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      // Keep a broken file aside instead of overwriting it with an empty planner.
      renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      return { events: [], ideas: [], dismissed: [] };
    }
  }

  private write(planner: Planner): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(planner, null, 2)}\n`);
    renameSync(tmp, this.file);
  }

  createEvent(input: unknown): CalendarEvent {
    const v = CalendarEventInput.parse(input);
    checkDates(v.at, v.endAt);
    const planner = this.read();
    const event: CalendarEvent = { id: randomUUID(), ...v, createdAt: new Date().toISOString() };
    planner.events.push(event);
    this.write(planner);
    return event;
  }

  updateEvent(id: string, input: unknown): CalendarEvent {
    const v = CalendarEventInput.parse(input);
    checkDates(v.at, v.endAt);
    const planner = this.read();
    const i = planner.events.findIndex((e) => e.id === id);
    const current = planner.events[i];
    if (!current) throw notFound("No such event", "event_not_found");
    const event: CalendarEvent = { ...current, ...v };
    planner.events[i] = event;
    this.write(planner);
    return event;
  }

  deleteEvent(id: string): void {
    const planner = this.read();
    const next = planner.events.filter((e) => e.id !== id);
    if (next.length === planner.events.length) throw notFound("No such event", "event_not_found");
    this.write({ ...planner, events: next });
  }

  createIdea(input: unknown): Idea {
    const v = IdeaInput.parse(input);
    const planner = this.read();
    const now = new Date().toISOString();
    const first = Math.min(
      0,
      ...planner.ideas.filter((i) => i.column === v.column).map((i) => i.order),
    );
    const idea: Idea = { id: randomUUID(), ...v, order: first - 1, createdAt: now, updatedAt: now };
    planner.ideas.push(idea);
    this.write(planner);
    return idea;
  }

  updateIdea(id: string, patch: IdeaPatch): Idea {
    const planner = this.read();
    const i = planner.ideas.findIndex((x) => x.id === id);
    const current = planner.ideas[i];
    if (!current) throw notFound("No such idea", "idea_not_found");
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const idea: Idea = { ...current, ...defined, updatedAt: new Date().toISOString() };
    planner.ideas[i] = idea;
    this.write(planner);
    return idea;
  }

  /** Remember that the user removed a done agenda item (keeps the newest 2000). */
  dismiss(id: string): void {
    const planner = this.read();
    if (planner.dismissed.includes(id)) return;
    this.write({ ...planner, dismissed: [...planner.dismissed, id].slice(-2000) });
  }

  deleteIdea(id: string): void {
    const planner = this.read();
    const next = planner.ideas.filter((x) => x.id !== id);
    if (next.length === planner.ideas.length) throw notFound("No such idea", "idea_not_found");
    this.write({ ...planner, ideas: next });
  }
}

function checkDates(at: string, endAt: string | null): void {
  const start = Date.parse(at);
  if (Number.isNaN(start)) throw badRequest("The start isn't a valid date", "invalid_date");
  if (endAt !== null) {
    const end = Date.parse(endAt);
    if (Number.isNaN(end)) throw badRequest("The end isn't a valid date", "invalid_date");
    if (end < start) throw badRequest("The end is before the start", "invalid_date");
  }
}
