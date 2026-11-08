import { cronError, describeCron, nextRuns } from "./cron";

/**
 * Human schedule choices (§10) and their cron expressions. The editor offers these first and
 * "Custom (cron)" last; automations always store the cron expression, so files stay plain.
 */
export type ScheduleChoice =
  | { kind: "minutes"; every: number }
  | { kind: "hours"; every: number; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; day: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "custom"; expression: string };

export type ScheduleKind = ScheduleChoice["kind"];

export const SCHEDULE_KINDS: { id: ScheduleKind; label: string }[] = [
  { id: "minutes", label: "Every few minutes" },
  { id: "hours", label: "Every few hours" },
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "custom", label: "Custom (cron)" },
];

/** Minute intervals that divide an hour, so `*\/N` runs evenly. */
export const MINUTE_STEPS = [5, 10, 15, 20, 30];
/** Hour intervals that divide a day. */
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);
const pad = (n: number) => String(n).padStart(2, "0");

/** `"09:30"` -> `[9, 30]`; invalid times fall back to 09:00. */
function hm(time: string): [number, number] {
  const m = TIME.exec(time);
  return m ? [Number(m[1]), Number(m[2])] : [9, 0];
}

/** The cron expression of a choice (5 fields, minute first). */
export function toCron(choice: ScheduleChoice): string {
  switch (choice.kind) {
    case "minutes":
      return `*/${choice.every} * * * *`;
    case "hours":
      return choice.every === 1
        ? `${choice.minute} * * * *`
        : `${choice.minute} */${choice.every} * * *`;
    case "daily": {
      const [h, m] = hm(choice.time);
      return `${m} ${h} * * *`;
    }
    case "weekdays": {
      const [h, m] = hm(choice.time);
      return `${m} ${h} * * 1-5`;
    }
    case "weekly": {
      const [h, m] = hm(choice.time);
      return `${m} ${h} * * ${choice.day}`;
    }
    case "monthly": {
      const [h, m] = hm(choice.time);
      return `${m} ${h} ${choice.day} * *`;
    }
    case "custom":
      return choice.expression.trim();
  }
}

/**
 * The human choice a cron expression matches, so a saved automation opens on the same choice
 * it was made with; anything else is `custom`.
 */
export function fromCron(expression: string): ScheduleChoice {
  const custom: ScheduleChoice = { kind: "custom", expression };
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return custom;
  const [min, hour, dom, month, dow] = parts;
  if (month !== "*") return custom;
  const everyMin = /^\*\/(\d+)$/.exec(min ?? "");
  if (everyMin && hour === "*" && dom === "*" && dow === "*") {
    const every = Number(everyMin[1]);
    return MINUTE_STEPS.includes(every) ? { kind: "minutes", every } : custom;
  }
  const minute = num(min);
  if (minute === null || minute > 59) return custom;
  if (dom === "*" && dow === "*") {
    if (hour === "*") return { kind: "hours", every: 1, minute };
    const everyHour = /^\*\/(\d+)$/.exec(hour ?? "");
    if (everyHour) {
      const every = Number(everyHour[1]);
      return HOUR_STEPS.includes(every) ? { kind: "hours", every, minute } : custom;
    }
  }
  const h = num(hour);
  if (h === null || h > 23) return custom;
  const time = `${pad(h)}:${pad(minute)}`;
  if (dom === "*" && dow === "*") return { kind: "daily", time };
  if (dom === "*" && (dow === "1-5" || dow?.toLowerCase() === "mon-fri")) {
    return { kind: "weekdays", time };
  }
  const weekday = num(dow);
  if (dom === "*" && weekday !== null && weekday <= 7) {
    return { kind: "weekly", day: weekday % 7, time };
  }
  const monthDay = num(dom);
  if (dow === "*" && monthDay !== null && monthDay >= 1 && monthDay <= 28) {
    return { kind: "monthly", day: monthDay, time };
  }
  return custom;
}

/** A fresh choice of `kind`, carrying the time of the previous choice where it has one. */
export function switchKind(kind: ScheduleKind, from: ScheduleChoice): ScheduleChoice {
  const time = "time" in from ? from.time : "09:00";
  switch (kind) {
    case "minutes":
      return { kind, every: 15 };
    case "hours":
      return { kind, every: 1, minute: 0 };
    case "daily":
    case "weekdays":
      return { kind, time };
    case "weekly":
      return { kind, day: 1, time };
    case "monthly":
      return { kind, day: 1, time };
    case "custom":
      return { kind, expression: toCron(from) };
  }
}

/** What the editor shows under a schedule: a summary, the next runs, or the cron error. */
export function schedulePreview(
  expression: string,
  timezone: string,
  count = 3,
  after?: Date,
): { summary: string; next: Date[]; error: string | null } {
  const error = cronError(expression, timezone);
  if (error) return { summary: "Invalid schedule", next: [], error };
  return {
    summary: describeCron(expression),
    next: nextRuns(expression, timezone, count, after),
    error,
  };
}
