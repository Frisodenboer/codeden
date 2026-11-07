import type {
  AutomationGuards,
  AutomationRun,
  ConflictDecision,
  WorkSummary,
} from "@codeden/contracts";
import { inQuietHours } from "./cron";

export type SkipReason = NonNullable<AutomationRun["skipReason"]>;

/** How a run was triggered. Manual runs bypass quiet hours, the daily cap and the concurrency cap. */
export type TriggerKind = AutomationRun["triggeredBy"];

export interface PreflightInput {
  guards: AutomationGuards;
  triggeredBy: TriggerKind;
  now: Date;
  timezone: string;
  /** Runs of this automation in this project that count against today's cap. */
  runsToday: number;
}

/** Quiet hours and the daily cap (§10), checked before anything else. */
export function preflightSkip(input: PreflightInput): SkipReason | null {
  if (input.triggeredBy === "manual") return null;
  const { guards } = input;
  if (guards.quietHours && inQuietHours(guards.quietHours, input.now, input.timezone)) {
    return "quiet_hours";
  }
  if (guards.maxPerDay !== null && input.runsToday >= guards.maxPerDay) return "daily_cap";
  return null;
}

/** What to do about running work with the same work key or an overlapping scope. */
export type OverlapOutcome =
  | { kind: "start" }
  | { kind: "skip"; reason: SkipReason }
  | { kind: "decide"; decision: ConflictDecision }
  /** A manual run without a decision: report the conflict, record nothing. */
  | { kind: "conflict"; existing: WorkSummary[] };

/**
 * Apply the overlap policy (§8.4): `skip-if-running` records a skipped run, `queue` waits behind
 * the existing work, `run-anyway` forces a start with the reason recorded. Manual runs return
 * the conflict to the caller unless it already passed a decision.
 */
export function overlapOutcome(
  guards: AutomationGuards,
  triggeredBy: TriggerKind,
  conflicts: WorkSummary[],
  decision?: ConflictDecision,
): OverlapOutcome {
  if (conflicts.length === 0) return { kind: "start" };
  if (decision) {
    return decision.resolution === "skip"
      ? { kind: "skip", reason: "conflict_skip" }
      : { kind: "decide", decision };
  }
  if (triggeredBy === "manual") return { kind: "conflict", existing: conflicts };
  switch (guards.overlapPolicy) {
    case "skip-if-running":
      return { kind: "skip", reason: "overlap" };
    case "queue":
      return { kind: "decide", decision: { resolution: "wait" } };
    case "run-anyway":
      return {
        kind: "decide",
        decision: {
          resolution: "force",
          reason: `Automation overlap policy is run-anyway (conflicts with ${conflicts
            .map((c) => c.workKey)
            .join(", ")})`,
        },
      };
  }
}

/**
 * The concurrency cap: at most `maxConcurrent` queued or running runs of one automation per
 * project. Runs that will queue behind other work, and manual runs, are not capped.
 */
export function overConcurrencyCap(
  guards: AutomationGuards,
  triggeredBy: TriggerKind,
  activeRuns: number,
  willQueue: boolean,
): boolean {
  if (triggeredBy === "manual" || willQueue) return false;
  return activeRuns >= guards.maxConcurrent;
}
