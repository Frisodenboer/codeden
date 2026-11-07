import type { AutomationProjectSettings } from "@codeden/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { automationProjects, automationSchedules } from "../../db/schema-automations";

export type ScheduleRow = typeof automationSchedules.$inferSelect;
export type SchedulePatch = Partial<Omit<ScheduleRow, "automationId" | "projectId" | "updatedAt">>;

/** A change to state the UI shows; `automationId` is null for a project's automation switch. */
export type ScheduleChange = { automationId: string | null; projectId: string };

/** Fields of a schedule row that the UI shows (`AutomationState`, upcoming runs). */
const VISIBLE = ["nextRunAt", "skipAt", "paused", "enabledOverride"] as const;

/**
 * Persisted scheduler state per automation and project, and each project's automation switch.
 * `onChange` hears about changes to visible state (not bookkeeping like `lastFiredAt`).
 */
export class ScheduleStore {
  constructor(
    private readonly db: Db,
    private readonly onChange?: (change: ScheduleChange) => void,
  ) {}

  get(automationId: string, projectId: string): ScheduleRow | undefined {
    return this.db
      .select()
      .from(automationSchedules)
      .where(
        and(
          eq(automationSchedules.automationId, automationId),
          eq(automationSchedules.projectId, projectId),
        ),
      )
      .get();
  }

  all(): ScheduleRow[] {
    return this.db.select().from(automationSchedules).all();
  }

  forAutomation(automationId: string): ScheduleRow[] {
    return this.db
      .select()
      .from(automationSchedules)
      .where(eq(automationSchedules.automationId, automationId))
      .all();
  }

  /** Insert or update the row for (automation, project) with `patch`. */
  upsert(automationId: string, projectId: string, patch: SchedulePatch): ScheduleRow {
    const now = new Date().toISOString();
    const current = this.get(automationId, projectId);
    const row: ScheduleRow = {
      automationId,
      projectId,
      signature: null,
      nextRunAt: null,
      skipAt: null,
      paused: false,
      enabledOverride: null,
      lastFiredAt: null,
      ...current,
      ...patch,
      updatedAt: now,
    };
    this.db
      .insert(automationSchedules)
      .values(row)
      .onConflictDoUpdate({
        target: [automationSchedules.automationId, automationSchedules.projectId],
        set: row,
      })
      .run();
    const visible = (r: ScheduleRow | undefined) => VISIBLE.map((k) => r?.[k] ?? null);
    const before = visible(current);
    if (visible(row).some((v, i) => v !== before[i])) this.onChange?.({ automationId, projectId });
    return row;
  }

  removeAutomation(automationId: string): void {
    this.db
      .delete(automationSchedules)
      .where(eq(automationSchedules.automationId, automationId))
      .run();
  }

  remove(automationId: string, projectId: string): void {
    this.db
      .delete(automationSchedules)
      .where(
        and(
          eq(automationSchedules.automationId, automationId),
          eq(automationSchedules.projectId, projectId),
        ),
      )
      .run();
  }

  projectSettings(projectId: string): AutomationProjectSettings {
    const row = this.db
      .select()
      .from(automationProjects)
      .where(eq(automationProjects.projectId, projectId))
      .get();
    return { projectId, enabled: row?.enabled ?? true, updatedAt: row?.updatedAt ?? null };
  }

  setProjectEnabled(projectId: string, enabled: boolean): AutomationProjectSettings {
    const row = { projectId, enabled, updatedAt: new Date().toISOString() };
    this.db
      .insert(automationProjects)
      .values(row)
      .onConflictDoUpdate({ target: automationProjects.projectId, set: row })
      .run();
    this.onChange?.({ automationId: null, projectId });
    return row;
  }
}
