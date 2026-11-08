import { plural } from "@/lib/format";

/** Longest summary a collapsed tool row shows; CSS truncates it further in narrow columns. */
export const SUMMARY_MAX = 80;

/** Object fields that usually describe a result, in order of preference. */
const SUMMARY_KEYS = [
  "summary",
  "message",
  "title",
  "name",
  "error",
  "status",
  "result",
  "text",
  "description",
];

/** The unmistakable start of a JSON document (`{"`, `[{`, `["`), even when it is cut short. */
const JSON_START = /^[[{]\s*[[{"]/;

/**
 * A short, readable one-line summary of a tool's text output for its collapsed row: a JSON
 * result gives its first descriptive field (or its item count), plain text its first non-empty
 * line. Capped at `max` characters. Undefined when there is nothing worth showing, such as
 * empty output or JSON without a descriptive field. The full output stays in the expanded
 * details.
 */
export function outputSummary(text: string | undefined, max = SUMMARY_MAX): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const summary = summarize(trimmed);
  return summary ? clip(summary, max) : undefined;
}

function summarize(text: string): string | undefined {
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return describeValue(JSON.parse(text), 0);
    } catch {
      // Cut-off JSON is never a readable summary; text like `[INFO] ready` falls through.
      if (JSON_START.test(text)) return undefined;
    }
  }
  return firstLine(text);
}

function describeValue(value: unknown, depth: number): string | undefined {
  if (typeof value === "string") return firstLine(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return plural(value.length, "item");
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return firstLine(field);
  }
  // A single wrapping key, like `{"issue": {...}}`, describes what it wraps.
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] !== undefined && depth < 2) {
    return describeValue(record[keys[0]], depth + 1);
  }
  return undefined;
}

/** First non-empty line with runs of whitespace collapsed. */
function firstLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return line?.replace(/\s+/g, " ");
}

/** Cut to `max` characters (by code point), ending with an ellipsis when cut. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}
