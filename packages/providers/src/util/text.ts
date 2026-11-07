import type { JsonValue, ToolOutput } from "@codeden/contracts";

/** Max characters of tool output kept inline in an item (§6: larger outputs are truncated). */
export const TOOL_OUTPUT_PREVIEW_CHARS = 16_000;

/** Build a `ToolOutput` preview, truncating long text. */
export function toolOutput(text: string, max = TOOL_OUTPUT_PREVIEW_CHARS): ToolOutput {
  const totalBytes = Buffer.byteLength(text, "utf8");
  if (text.length <= max) return { text, truncated: false, totalBytes };
  return { text: `${text.slice(0, max)}\n...`, truncated: true, totalBytes };
}

/** One-line summary for titles: first line, trimmed and shortened. */
export function shorten(text: string, max = 80): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Coerce an arbitrary value to JSON (drops functions/undefined, breaks cycles). */
export function toJson(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
  } catch {
    return null;
  }
}

/** Read a string field from an untyped record. */
export function str(record: unknown, key: string): string | undefined {
  if (record && typeof record === "object") {
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Read a number field from an untyped record. */
export function num(record: unknown, key: string): number | undefined {
  if (record && typeof record === "object") {
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Non-negative integer or undefined (for token counts). */
export function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/** Unix seconds or ms to ISO-8601, or undefined. */
export function unixToIso(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
}
