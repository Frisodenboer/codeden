import type { Automation, Project, ScheduledRun } from "@codeden/contracts";
import { errorMessage } from "../errors";
import { nextOccurrence, scheduleSignature } from "./cron";
import { baseVars, renderWorkKey } from "./prompt";
import type { ScheduleRow, ScheduleStore } from "./schedule-store";

/** A cron automation that is enabled and not paused in a project. */
export interface SchedulePair {
  automation: Automation;
  project: Project;
  expression: string;
  timezone: string;
}

export interface SchedulerDeps {
  store: ScheduleStore;
  /** Every schedulable (automation, project) pair right now. */
  pairs: () => SchedulePair[];
  fire: (pair: SchedulePair, triggeredBy: "cron" | "catch_up") => Promise<unknown>;
  /** Record the occurrence a PM skipped (`skip_next_run`). */
  skipped: (pair: SchedulePair, at: string) => void;
  now: () => Date;
  /** How late an occurrence may fire before it counts as missed (default 2 minutes). */
  graceMs?: number;
  /** Longest timer wait, so clock changes and sleep are noticed (default 60 s). */
  maxWaitMs?: number;
  log?: (message: string) => void;
}

const key = (automationId: string, projectId: string) => `${automationId}\u0000${projectId}`;

/**
 * The cron scheduler (§10). croner computes occurrences in the automation's timezone; the next
 * occurrence per (automation, project) is persisted, so it survives restarts. An occurrence
 * that is overdue by more than the grace period (the server was down or asleep) is missed:
 * it runs once as `catch_up` when the automation's `catchUpMissed` guard is on, otherwise it
 * is dropped. One timer is armed for the soonest occurrence.
 */
export class CronScheduler {
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private stopped = true;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.stopped = false;
    this.refresh();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Recompute next runs for new or changed schedules, clear unscheduled ones, process anything
   * already due and re-arm the timer. Call after any definition, project or state change.
   */
  refresh(): void {
    const now = this.deps.now();
    const live = new Set<string>();
    for (const pair of this.deps.pairs()) {
      live.add(key(pair.automation.id, pair.project.id));
      const row = this.deps.store.get(pair.automation.id, pair.project.id);
      const signature = scheduleSignature(pair.expression, pair.timezone);
      if (row?.nextRunAt && row.signature === signature) continue;
      const next = nextOccurrence(pair.expression, pair.timezone, now);
      this.deps.store.upsert(pair.automation.id, pair.project.id, {
        signature,
        nextRunAt: next?.toISOString() ?? null,
        skipAt: null,
      });
    }
    for (const row of this.deps.store.all()) {
      if (row.nextRunAt && !live.has(key(row.automationId, row.projectId))) {
        this.deps.store.upsert(row.automationId, row.projectId, {
          nextRunAt: null,
          signature: null,
          skipAt: null,
        });
      }
    }
    void this.tick();
  }

  /** Fire every due occurrence, then re-arm. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = this.deps.now();
      const grace = this.deps.graceMs ?? 120_000;
      for (const pair of this.deps.pairs()) {
        const row = this.deps.store.get(pair.automation.id, pair.project.id);
        if (!row?.nextRunAt || Date.parse(row.nextRunAt) > now.getTime()) continue;
        const at = row.nextRunAt;
        const missed = now.getTime() - Date.parse(at) > grace;
        const next = nextOccurrence(pair.expression, pair.timezone, now);
        this.deps.store.upsert(pair.automation.id, pair.project.id, {
          nextRunAt: next?.toISOString() ?? null,
          skipAt: null,
          lastFiredAt: now.toISOString(),
        });
        try {
          if (row.skipAt === at) this.deps.skipped(pair, at);
          else if (!missed) await this.deps.fire(pair, "cron");
          else if (pair.automation.guards.catchUpMissed) await this.deps.fire(pair, "catch_up");
          else this.deps.log?.(`automations: missed ${pair.automation.id} at ${at} (no catch-up)`);
        } catch (error) {
          this.deps.log?.(
            `automations: ${pair.automation.id} failed to fire: ${errorMessage(error)}`,
          );
        }
      }
    } finally {
      this.ticking = false;
      this.arm();
    }
  }

  /** Upcoming runs, soonest first; a skipped occurrence is listed with the one after it. */
  upcoming(projectId: string | null, limit: number): ScheduledRun[] {
    const out: ScheduledRun[] = [];
    for (const pair of this.deps.pairs()) {
      if (projectId && pair.project.id !== projectId) continue;
      const row = this.deps.store.get(pair.automation.id, pair.project.id);
      if (!row?.nextRunAt) continue;
      const base = {
        automationId: pair.automation.id,
        projectId: pair.project.id,
        name: pair.automation.name,
        workKey: renderWorkKey(
          pair.automation,
          baseVars(pair.project, new Date(row.nextRunAt), pair.timezone),
        ),
      };
      const skipped = row.skipAt === row.nextRunAt;
      out.push({ ...base, at: row.nextRunAt, skipped });
      if (skipped) {
        const after = nextOccurrence(pair.expression, pair.timezone, new Date(row.nextRunAt));
        if (after) out.push({ ...base, at: after.toISOString(), skipped: false });
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit);
  }

  /** Mark the next occurrence as skipped; returns the schedule row, or null when none. */
  skipNext(automationId: string, projectId: string): ScheduleRow | null {
    const row = this.deps.store.get(automationId, projectId);
    if (!row?.nextRunAt) return null;
    return this.deps.store.upsert(automationId, projectId, { skipAt: row.nextRunAt });
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const now = this.deps.now().getTime();
    let soonest = Number.POSITIVE_INFINITY;
    for (const row of this.deps.store.all()) {
      if (row.nextRunAt) soonest = Math.min(soonest, Date.parse(row.nextRunAt));
    }
    const maxWait = this.deps.maxWaitMs ?? 60_000;
    const wait = Number.isFinite(soonest) ? Math.min(Math.max(soonest - now, 0), maxWait) : maxWait;
    this.timer = setTimeout(() => void this.tick(), wait + 5);
    this.timer.unref();
  }
}
