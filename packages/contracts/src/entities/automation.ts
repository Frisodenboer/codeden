import { z } from "zod";
import {
  AutonomyLevel,
  ErrorInfo,
  Id,
  ProviderId,
  QuietHours,
  ReasoningEffort,
  Timestamp,
} from "../common";

/** Events an automation can be triggered by (§10). */
export const AutomationEventName = z.enum([
  "session.finished",
  "session.failed",
  "session.needs_input",
  "pr.opened",
  "pr.merged",
  "pr.checks_failed",
  "pr.review_requested",
  "issue.opened",
  "issue.labeled",
  "issue.commented",
]);
export type AutomationEventName = z.infer<typeof AutomationEventName>;

/** When an automation fires. */
export const AutomationTrigger = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    /** Cron expression (croner syntax). */
    expression: z.string().min(1),
    /** IANA timezone; defaults to the project's timezone. */
    timezone: z.string().optional(),
  }),
  z.object({
    type: z.literal("event"),
    event: AutomationEventName,
    filter: z
      .object({
        labels: z.array(z.string()).optional(),
        branches: z.array(z.string()).optional(),
        authors: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal("manual") }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

/** What an automation does when it fires. */
export const AutomationAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_session"),
    /** Prompt template (Markdown, `{{placeholders}}` filled from the trigger context). */
    prompt: z.string().min(1),
    title: z.string().optional(),
    provider: ProviderId.optional(),
    model: z.string().optional(),
    effort: ReasoningEffort.optional(),
    autonomy: AutonomyLevel.optional(),
  }),
  z.object({
    type: z.literal("message_pm"),
    message: z.string().min(1),
  }),
  z.object({ type: z.literal("triage") }),
]);
export type AutomationAction = z.infer<typeof AutomationAction>;

/** Which projects an automation applies to. */
export const AutomationTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), projectId: Id }),
  z.object({ type: z.literal("all_projects") }),
]);
export type AutomationTarget = z.infer<typeof AutomationTarget>;

/** Safety rails on automation runs (§10). */
export const AutomationGuards = z.object({
  /** Skip a run while the previous one is still going. */
  noOverlap: z.boolean().default(true),
  maxConcurrent: z.int().positive().default(1),
  maxPerDay: z.int().positive().nullable().default(null),
  quietHours: QuietHours.nullable().default(null),
  /** Run once for missed schedules after downtime. */
  catchUpMissed: z.boolean().default(false),
});
export type AutomationGuards = z.infer<typeof AutomationGuards>;

/** An automation: trigger + action + target + guards. Off by default. */
export const Automation = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().nullable(),
  enabled: z.boolean().default(false),
  /** Where the definition lives. */
  source: z.enum(["builtin", "global_file", "project_file", "database"]),
  /** Template this was created from, if any. */
  templateId: z.string().nullable(),
  trigger: AutomationTrigger,
  action: AutomationAction,
  target: AutomationTarget,
  guards: AutomationGuards.prefault({}),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Automation = z.infer<typeof Automation>;

/**
 * Frontmatter of an automation template file (Markdown + YAML; the body is the prompt).
 * Lives in `~/.codeden/automations/` or a repo's `.codeden/automations/`.
 */
export const AutomationTemplateFrontmatter = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: AutomationTrigger,
  provider: ProviderId.optional(),
  model: z.string().optional(),
  autonomy: AutonomyLevel.optional(),
  guards: AutomationGuards.partial().optional(),
});
export type AutomationTemplateFrontmatter = z.infer<typeof AutomationTemplateFrontmatter>;

export const AutomationRunStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatus>;

/** One execution of an automation. Every run is a normal session or PM turn (§10). */
export const AutomationRun = z.object({
  id: Id,
  automationId: Id,
  projectId: Id.nullable(),
  status: AutomationRunStatus,
  triggeredBy: z.enum(["cron", "event", "manual", "catch_up"]),
  skipReason: z.enum(["overlap", "concurrency", "quiet_hours", "daily_cap", "disabled"]).nullable(),
  sessionId: Id.nullable(),
  startedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  error: ErrorInfo.nullable(),
});
export type AutomationRun = z.infer<typeof AutomationRun>;
