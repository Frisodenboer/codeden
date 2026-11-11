import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { PlannerStore } from "../src/services/planner/planner-store";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codebench-planner-"));
  file = join(dir, "planner.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("planner store", () => {
  it("starts empty and keeps events across reads", () => {
    const store = new PlannerStore(file);
    expect(store.read()).toEqual({ events: [], ideas: [], dismissed: [] });
    const e = store.createEvent({ title: "Dentist", at: "2026-11-20T09:00:00.000Z" });
    expect(e).toMatchObject({ allDay: false, repeat: "none", endAt: null, notes: "" });
    expect(new PlannerStore(file).read().events).toHaveLength(1);
    store.updateEvent(e.id, { title: "Dentist (moved)", at: "2026-11-21T09:00:00.000Z" });
    expect(store.read().events[0]?.title).toBe("Dentist (moved)");
    store.deleteEvent(e.id);
    expect(store.read().events).toEqual([]);
  });

  it("rejects an end before the start and unknown ids", () => {
    const store = new PlannerStore(file);
    expect(() =>
      store.createEvent({ title: "x", at: "2026-11-20T10:00:00Z", endAt: "2026-11-20T09:00:00Z" }),
    ).toThrow(ServiceError);
    expect(() => store.deleteEvent("nope")).toThrow(ServiceError);
    expect(() => store.updateIdea("nope", { column: "next" })).toThrow(ServiceError);
  });

  it("puts new ideas at the top of their column and moves them between columns", () => {
    const store = new PlannerStore(file);
    const a = store.createIdea({ title: "A" });
    const b = store.createIdea({ title: "B" });
    expect(b.order).toBeLessThan(a.order);
    const moved = store.updateIdea(a.id, { column: "sent" });
    expect(moved.column).toBe("sent");
    expect(moved.title).toBe("A");
    store.deleteIdea(b.id);
    expect(store.read().ideas.map((i) => i.title)).toEqual(["A"]);
  });

  it("sets a broken file aside instead of overwriting it", () => {
    writeFileSync(file, "{ not json");
    const store = new PlannerStore(file);
    expect(store.read()).toEqual({ events: [], ideas: [], dismissed: [] });
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith("planner.json.broken-"))).toBe(true);
  });
});
