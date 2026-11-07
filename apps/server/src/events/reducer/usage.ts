import type { Usage } from "@codeden/contracts";

/** Fields that add up across turns. */
const ADDITIVE = [
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "costUsd",
] as const;

/** True when a report carries token counts or cost (not only rate limits or context size). */
export function hasTokenCounts(usage: Usage): boolean {
  return ADDITIVE.some((field) => usage[field] !== undefined);
}

/** Fields where only the latest report matters. */
const LATEST = ["contextTokens", "contextWindow", "rateLimits"] as const;

/**
 * Fold a turn's usage report into the session total. A `usage.updated` with a `turnId`
 * reports that turn's usage so far (replacing its previous report), so the total is
 * `total - previous + next` for additive fields; context size and rate limits take the latest
 * value. Pure.
 */
export function accumulateUsage(
  total: Usage | null,
  previousTurn: Usage | null,
  nextTurn: Usage,
): Usage {
  const out: Usage = { ...(total ?? {}) };
  for (const field of ADDITIVE) {
    const t = total?.[field];
    const p = previousTurn?.[field];
    const n = nextTurn[field];
    if (t === undefined && p === undefined && n === undefined) continue;
    const value = (t ?? 0) - (p ?? 0) + (n ?? 0);
    const rounded = field === "costUsd" ? Math.round(value * 1e9) / 1e9 : Math.round(value);
    out[field] = Math.max(0, rounded);
  }
  return mergeLatest(out, nextTurn);
}

/**
 * A session-level usage report (no `turnId`): only context size and rate limits are taken,
 * since token counts without a turn cannot be attributed safely. Pure.
 */
export function mergeLatestUsage(total: Usage | null, report: Usage): Usage {
  return mergeLatest({ ...(total ?? {}) }, report);
}

function mergeLatest(out: Usage, report: Usage): Usage {
  for (const field of LATEST) {
    const value = report[field];
    if (value !== undefined) (out as Record<string, unknown>)[field] = value;
  }
  return out;
}
