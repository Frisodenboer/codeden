import type { CalendarEvent } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { occurrences } from "../src/lib/planner";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e",
  title: "x",
  at: new Date(2026, 10, 3, 9, 0).toISOString(),
  endAt: null,
  allDay: false,
  repeat: "none",
  projectId: null,
  notes: "",
  createdAt: new Date(2026, 10, 1).toISOString(),
  ...over,
});

describe("calendar occurrences", () => {
  const from = new Date(2026, 10, 1);
  const to = new Date(2026, 11, 1);
  it("keeps a one-off event only inside the range", () => {
    expect(occurrences([event({})], from, to)).toHaveLength(1);
    expect(occurrences([event({})], new Date(2026, 10, 4), to)).toHaveLength(0);
  });
  it("expands weekly and monthly repeats", () => {
    const weekly = occurrences([event({ repeat: "weekly" })], from, to);
    expect(weekly.map((o) => o.start.getDate())).toEqual([3, 10, 17, 24]);
    const monthly = occurrences([event({ repeat: "monthly" })], from, new Date(2027, 1, 1));
    expect(monthly.map((o) => o.start.getMonth())).toEqual([10, 11, 0]);
  });
});
