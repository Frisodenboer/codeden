import { Cron } from "croner";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const isNum = (s: string) => /^\d+$/.test(s);
const pad = (s: string | number) => String(s).padStart(2, "0");

function ordinal(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function dayNumber(token: string): number | null {
  const t = token.toLowerCase();
  if (isNum(t)) return Number(t) % 7;
  return DAY_ALIASES[t] ?? null;
}

/** "every Monday", "Mondays and Thursdays", "every weekday", "Monday to Wednesday", or null. */
function describeDays(field: string): string | null {
  if (field === "1-5" || field.toLowerCase() === "mon-fri") return "every weekday";
  if (field === "0,6" || field === "6,0") return "every weekend day";
  const range = field.split("-");
  if (range.length === 2) {
    const [a, b] = range.map((d) => dayNumber(d));
    if (a == null || b == null) return null;
    return `${DAY_NAMES[a]} to ${DAY_NAMES[b]}`;
  }
  const days = field.split(",").map(dayNumber);
  if (days.some((d) => d == null)) return null;
  if (days.length === 1) return `every ${DAY_NAMES[days[0] ?? 0]}`;
  const names = days.map((d) => `${DAY_NAMES[d ?? 0]}s`);
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * A plain-English description of a 5-field cron expression ("Every Monday at 03:00",
 * "Every 15 minutes", "Weekdays at 09:30"). Unusual expressions fall back to "Custom schedule".
 */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 6) parts.shift(); // Seconds field.
  if (parts.length !== 5) return "Custom schedule";
  const [min = "", hour = "", dom = "", month = "", dow = ""] = parts;
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return everyMin[1] === "1" ? "Every minute" : `Every ${everyMin[1]} minutes`;
  }
  if (min === "*" && hour === "*" && dom === "*" && month === "*" && dow === "*")
    return "Every minute";
  if (!isNum(min) || month !== "*") return "Custom schedule";
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (hour === "*" && dom === "*" && dow === "*") return `Every hour at :${pad(min)}`;
  if (everyHour && dom === "*" && dow === "*") {
    return `Every ${everyHour[1]} hours at :${pad(min)}`;
  }
  if (!isNum(hour)) return "Custom schedule";
  const time = `${pad(hour)}:${pad(min)}`;
  if (dom === "*" && dow === "*") return `Every day at ${time}`;
  if (dom === "*") {
    const days = describeDays(dow);
    if (!days) return "Custom schedule";
    return `${days.charAt(0).toUpperCase()}${days.slice(1)} at ${time}`;
  }
  const doms = dom.split(",");
  if (dow === "*" && doms.every(isNum)) {
    const days = doms.map((d) => ordinal(Number(d)));
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days[0];
    return `Monthly on the ${list} at ${time}`;
  }
  return "Custom schedule";
}

/** The parse error of a cron expression, or null when croner accepts it. */
export function cronError(expression: string, timezone?: string): string | null {
  try {
    new Cron(expression, timezone ? { timezone } : {});
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The next `count` occurrences after `after` (now), or [] for an invalid expression. */
export function nextRuns(
  expression: string,
  timezone: string | undefined,
  count: number,
  after?: Date,
): Date[] {
  try {
    return new Cron(expression, timezone ? { timezone } : {}).nextRuns(count, after);
  } catch {
    return [];
  }
}

/** Common schedules offered as presets in the trigger editor. */
export const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily 03:00", expression: "0 3 * * *" },
  { label: "Weekdays 09:00", expression: "0 9 * * 1-5" },
  { label: "Mondays 03:00", expression: "0 3 * * 1" },
  { label: "Monthly", expression: "0 4 1 * *" },
];

/** The machine's IANA timezone. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** IANA timezones the browser knows (falls back to a short list). */
export function timezones(): string[] {
  const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Europe/London", "America/New_York"];
  return list.includes("UTC") ? list : ["UTC", ...list];
}

/** "Mon 10 Nov, 03:00" in the given timezone. */
export function formatAt(date: Date | string, timezone?: string): string {
  return new Date(date).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}
