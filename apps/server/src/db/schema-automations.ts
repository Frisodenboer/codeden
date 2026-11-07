import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Automation scheduler state (§10). Operational state like `runner_state` and
 * `github_sync_state`, written directly rather than through events: definitions
 * (`automations`) and runs (`automation_runs`) stay event-sourced, while the next cron
 * occurrence, pauses and skips are recomputed or re-entered after a restore.
 */

/** Per automation and project: the persisted next run, a skipped occurrence, pause, override. */
export const automationSchedules = sqliteTable(
  "automation_schedules",
  {
    automationId: text("automation_id").notNull(),
    projectId: text("project_id").notNull(),
    /** Cron expression and timezone the next run was computed from (`expr|tz`). */
    signature: text("signature"),
    nextRunAt: text("next_run_at"),
    /** The occurrence `skip_next_run` skips (equals `nextRunAt` until it passes). */
    skipAt: text("skip_at"),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    /** Per-project override of `enabled` for automations that target all projects. */
    enabledOverride: integer("enabled_override", { mode: "boolean" }),
    lastFiredAt: text("last_fired_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.automationId, t.projectId] })],
);

/** A project's automation switch; no row means on (each automation is still off by default). */
export const automationProjects = sqliteTable("automation_projects", {
  projectId: text("project_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});
