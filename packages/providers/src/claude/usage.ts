import type { Usage } from "@codeden/contracts";
import { count, num, str, unixToIso } from "../util/text";

interface ModelUsageEntry {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  thinkingTokens?: number;
  contextWindow?: number;
}

/**
 * Usage from a `result` message. `modelUsage` and `total_cost_usd` are cumulative for the whole
 * query (all turns, subagents included), so this reports session totals.
 */
export function usageFromResult(result: unknown, contextTokens: number | undefined): Usage {
  const modelUsage = ((result as { modelUsage?: Record<string, ModelUsageEntry> }).modelUsage ??
    {}) as Record<string, ModelUsageEntry>;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let thinking = 0;
  let contextWindow: number | undefined;
  for (const entry of Object.values(modelUsage)) {
    input += entry.inputTokens ?? 0;
    output += entry.outputTokens ?? 0;
    cacheRead += entry.cacheReadInputTokens ?? 0;
    cacheWrite += entry.cacheCreationInputTokens ?? 0;
    thinking += entry.thinkingTokens ?? 0;
    if (entry.contextWindow && entry.contextWindow > (contextWindow ?? 0)) {
      contextWindow = entry.contextWindow;
    }
  }
  const usage: Usage = {
    inputTokens: count(input),
    outputTokens: count(output),
    cachedInputTokens: count(cacheRead),
    cacheWriteTokens: count(cacheWrite),
    reasoningTokens: thinking > 0 ? count(thinking) : undefined,
    contextTokens: count(contextTokens),
    contextWindow: contextWindow && contextWindow > 0 ? Math.round(contextWindow) : undefined,
    costUsd: num(result, "total_cost_usd"),
  };
  return stripUndefined(usage);
}

const ADDITIVE = [
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "costUsd",
] as const;

/**
 * One turn's own usage from two running totals of the same query: `total` now minus
 * `baseline` (the total when the turn began; none for the first turn of a process). Fields
 * are clamped at zero, since a running total can dip slightly (compaction). Context size and
 * window are kept from `total`. Pure.
 */
export function turnDelta(total: Usage, baseline: Usage | undefined): Usage {
  const out: Usage = { ...total };
  for (const field of ADDITIVE) {
    const now = total[field];
    if (now === undefined) continue;
    const diff = Math.max(0, now - (baseline?.[field] ?? 0));
    out[field] = field === "costUsd" ? Math.round(diff * 1e9) / 1e9 : Math.round(diff);
  }
  return out;
}

/** Tokens occupying the context window, from an assistant message's `usage`. */
export function contextTokensFromMessageUsage(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const total =
    (count(u.input_tokens) ?? 0) +
    (count(u.cache_read_input_tokens) ?? 0) +
    (count(u.cache_creation_input_tokens) ?? 0);
  return total > 0 ? total : undefined;
}

const WINDOW_IDS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "weekly",
  seven_day_opus: "weekly-opus",
  seven_day_sonnet: "weekly-sonnet",
};

/** Usage carrying the rate-limit state from a `rate_limit_event`. */
export function usageFromRateLimit(event: unknown): Usage | undefined {
  const info = (event as { rate_limit_info?: unknown }).rate_limit_info;
  if (!info || typeof info !== "object") return undefined;
  const type = str(info, "rateLimitType") ?? "unknown";
  const rawStatus = str(info, "status");
  const status =
    rawStatus === "rejected" ? "limited" : rawStatus === "allowed_warning" ? "warning" : "ok";
  const utilization = num(info, "utilization");
  const usedPercent =
    utilization === undefined
      ? undefined
      : Math.min(100, Math.max(0, utilization <= 1 ? utilization * 100 : utilization));
  const resetsAt = unixToIso(num(info, "resetsAt"));
  return {
    rateLimits: [
      stripUndefined({ id: WINDOW_IDS[type] ?? type, status, usedPercent, resetsAt }) as {
        id: string;
        status: "ok" | "warning" | "limited";
      },
    ],
  };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
