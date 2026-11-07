import type {
  CostSource,
  ModelPrice,
  Role,
  UsageDimension,
  UsageQuery,
  UsageSeries,
  UsageSource,
  UsageTotals,
} from "@codeden/contracts";
import { costOf } from "./prices";

/** A ledger row as reports see it: tokens, attribution, priced cost and local day. */
export interface PricedRow {
  sessionId: string;
  turnId: string;
  projectId: string | null;
  provider: string;
  model: string;
  role: Role;
  source: UsageSource;
  automationId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  reportedCostUsd: number | null;
  costUsd: number;
  costSource: CostSource;
  ts: string;
  /** Local day (YYYY-MM-DD) in the report timezone. */
  day: string;
}

export type LedgerRow = Omit<PricedRow, "costUsd" | "costSource" | "day">;

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The local day (YYYY-MM-DD) an instant falls on in `timeZone`. */
export function dayKey(ts: string | number | Date, timeZone: string): string {
  let fmt = dayFormats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormats.set(timeZone, fmt);
  }
  return fmt.format(new Date(ts));
}

/** `day` moved by `n` days (calendar arithmetic, no timezone involved). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, inclusive (capped at 400). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A generous UTC window around local days (timezones span -12h to +14h). */
export function utcWindow(from: string, to: string): { start: string; end: string } {
  return {
    start: new Date(Date.parse(`${from}T00:00:00.000Z`) - 15 * 3_600_000).toISOString(),
    end: new Date(Date.parse(`${addDays(to, 1)}T00:00:00.000Z`) + 15 * 3_600_000).toISOString(),
  };
}

/** Price ledger rows and stamp their local day. */
export function priceRows(rows: LedgerRow[], prices: ModelPrice[], timeZone: string): PricedRow[] {
  return rows.map((r) => ({ ...r, ...costOf(r, prices), day: dayKey(r.ts, timeZone) }));
}

/** Rows inside the query's days and filters. */
export function filterRows(rows: PricedRow[], q: UsageQuery): PricedRow[] {
  return rows.filter(
    (r) =>
      r.day >= q.from &&
      r.day <= q.to &&
      (!q.projectId || r.projectId === q.projectId) &&
      (!q.provider || r.provider === q.provider) &&
      (!q.model || r.model === q.model) &&
      (!q.role || r.role === q.role) &&
      (!q.source || r.source === q.source),
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function tokensOf(r: PricedRow): number {
  return r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
}

/** Totals over rows. */
export function totalsOf(rows: PricedRow[]): UsageTotals {
  const t = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    estimatedCostUsd: 0,
    unpricedTurns: 0,
  };
  const sessions = new Set<string>();
  for (const r of rows) {
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.cacheReadTokens += r.cacheReadTokens;
    t.cacheWriteTokens += r.cacheWriteTokens;
    t.reasoningTokens += r.reasoningTokens;
    t.costUsd += r.costUsd;
    if (r.costSource === "estimated") t.estimatedCostUsd += r.costUsd;
    if (r.costSource === "unpriced" && tokensOf(r) > 0) t.unpricedTurns++;
    sessions.add(r.sessionId);
  }
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  return {
    ...t,
    costUsd: round(t.costUsd),
    estimatedCostUsd: round(t.estimatedCostUsd),
    turns: rows.length,
    sessions: sessions.size,
    cacheHitRate: prompt > 0 ? t.cacheReadTokens / prompt : null,
  };
}

/** The key a row has along a dimension. */
export function keyOf(r: PricedRow, dim: UsageDimension): string {
  switch (dim) {
    case "provider":
      return r.provider;
    case "model":
      return r.model;
    case "project":
      return r.projectId ?? "";
    case "role":
      return r.role;
    case "source":
      return r.source;
  }
}

/**
 * Daily cost and tokens per value of a dimension, largest first. Values past `limit` fold
 * into one "Other" series so a stacked chart stays readable.
 */
export function seriesOf(
  rows: PricedRow[],
  days: string[],
  dim: UsageDimension,
  labelOf: (key: string) => string,
  limit = 8,
): UsageSeries[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const byKey = new Map<string, UsageSeries & { sessionSet: Set<string> }>();
  for (const r of rows) {
    const key = keyOf(r, dim);
    let s = byKey.get(key);
    if (!s) {
      s = {
        key,
        label: labelOf(key),
        costUsd: 0,
        estimatedCostUsd: 0,
        tokens: 0,
        turns: 0,
        sessions: 0,
        dailyCostUsd: days.map(() => 0),
        dailyTokens: days.map(() => 0),
        sessionSet: new Set(),
      };
      byKey.set(key, s);
    }
    const i = index.get(r.day);
    const tokens = tokensOf(r);
    s.costUsd += r.costUsd;
    if (r.costSource === "estimated") s.estimatedCostUsd += r.costUsd;
    s.tokens += tokens;
    s.turns++;
    s.sessionSet.add(r.sessionId);
    if (i !== undefined) {
      s.dailyCostUsd[i] = (s.dailyCostUsd[i] ?? 0) + r.costUsd;
      s.dailyTokens[i] = (s.dailyTokens[i] ?? 0) + tokens;
    }
  }
  const all = [...byKey.values()]
    .map(({ sessionSet, ...s }) => ({ ...s, sessions: sessionSet.size }))
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
  const kept = all.slice(0, limit);
  const rest = all.slice(limit);
  if (rest.length > 0) {
    kept.push({
      key: "__other",
      label: `Other (${rest.length})`,
      costUsd: sum(rest.map((s) => s.costUsd)),
      estimatedCostUsd: sum(rest.map((s) => s.estimatedCostUsd)),
      tokens: sum(rest.map((s) => s.tokens)),
      turns: sum(rest.map((s) => s.turns)),
      sessions: sum(rest.map((s) => s.sessions)),
      dailyCostUsd: days.map((_, i) => sum(rest.map((s) => s.dailyCostUsd[i] ?? 0))),
      dailyTokens: days.map((_, i) => sum(rest.map((s) => s.dailyTokens[i] ?? 0))),
    });
  }
  return kept.map((s) => ({
    ...s,
    costUsd: round(s.costUsd),
    estimatedCostUsd: round(s.estimatedCostUsd),
    dailyCostUsd: s.dailyCostUsd.map(round),
  }));
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Per-session totals, most expensive first. */
export function sessionTotals(rows: PricedRow[]) {
  const map = new Map<
    string,
    {
      sessionId: string;
      costUsd: number;
      estimated: boolean;
      tokens: number;
      turns: number;
      lastAt: string;
      first: PricedRow;
    }
  >();
  for (const r of rows) {
    const s = map.get(r.sessionId) ?? {
      sessionId: r.sessionId,
      costUsd: 0,
      estimated: false,
      tokens: 0,
      turns: 0,
      lastAt: r.ts,
      first: r,
    };
    s.costUsd += r.costUsd;
    s.estimated ||= r.costSource !== "reported";
    s.tokens += tokensOf(r);
    s.turns++;
    if (r.ts > s.lastAt) s.lastAt = r.ts;
    map.set(r.sessionId, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, costUsd: round(s.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
