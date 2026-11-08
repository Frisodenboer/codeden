import { describe, expect, it } from "vitest";
import { fromCron, type ScheduleChoice, schedulePreview, switchKind, toCron } from "@/lib/schedule";

describe("human schedule choices", () => {
  const cases: [ScheduleChoice, string, string][] = [
    [{ kind: "minutes", every: 15 }, "*/15 * * * *", "Every 15 minutes"],
    [{ kind: "hours", every: 1, minute: 30 }, "30 * * * *", "Every hour at :30"],
    [{ kind: "hours", every: 6, minute: 0 }, "0 */6 * * *", "Every 6 hours at :00"],
    [{ kind: "daily", time: "03:00" }, "0 3 * * *", "Every day at 03:00"],
    [{ kind: "weekdays", time: "09:00" }, "0 9 * * 1-5", "Every weekday at 09:00"],
    [{ kind: "weekly", day: 1, time: "08:15" }, "15 8 * * 1", "Every Monday at 08:15"],
    [{ kind: "monthly", day: 15, time: "04:00" }, "0 4 15 * *", "Monthly on the 15th at 04:00"],
  ];

  it("turns each choice into cron, a plain-English summary, and back", () => {
    for (const [choice, cron, summary] of cases) {
      expect(toCron(choice)).toBe(cron);
      expect(fromCron(cron)).toEqual(choice);
      expect(schedulePreview(cron, "UTC").summary).toBe(summary);
    }
  });

  it("opens anything else as a custom cron expression", () => {
    for (const cron of ["0 4 1,15 * *", "*/7 * * * *", "0 9 * * 1,3", "0 0 1 1 *", "0 9 31 * *"]) {
      expect(fromCron(cron)).toEqual({ kind: "custom", expression: cron });
    }
    expect(fromCron("0 9 * * 0")).toEqual({ kind: "weekly", day: 0, time: "09:00" });
    expect(fromCron("0 9 * * 7")).toEqual({ kind: "weekly", day: 0, time: "09:00" });
  });

  it("keeps the time when switching kinds, and custom starts from the current cron", () => {
    const weekly = switchKind("weekly", { kind: "daily", time: "07:45" });
    expect(weekly).toEqual({ kind: "weekly", day: 1, time: "07:45" });
    expect(switchKind("custom", weekly)).toEqual({ kind: "custom", expression: "45 7 * * 1" });
    expect(switchKind("minutes", weekly)).toEqual({ kind: "minutes", every: 15 });
  });

  it("lists the next three runs in the chosen timezone, or the error", () => {
    const after = new Date("2026-11-06T15:00:00Z"); // A Friday afternoon (UTC).
    const ny = schedulePreview("0 9 * * 1-5", "America/New_York", 3, after);
    expect(ny.error).toBeNull();
    expect(ny.next.map((d) => d.toISOString())).toEqual([
      "2026-11-09T14:00:00.000Z",
      "2026-11-10T14:00:00.000Z",
      "2026-11-11T14:00:00.000Z",
    ]);
    const tokyo = schedulePreview("0 9 * * 1-5", "Asia/Tokyo", 1, after);
    expect(tokyo.next[0]?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    const bad = schedulePreview("61 * * * *", "UTC");
    expect(bad.error).toBeTruthy();
    expect(bad.next).toEqual([]);
  });
});
