import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * Situational awareness and conflict handling (§8.4). Every unit of work (a session or an
 * automation run) is described in data so the orchestrator and PMs always know what is
 * running, and starting work never silently duplicates work already in progress.
 */

/** Who started a unit of work. `id` is the user/session/automation id where applicable. */
export const StartedBy = z.object({
  kind: z.enum(["user", "orchestrator", "pm", "automation"]),
  id: z.string().optional(),
  /**
   * Who else hears when the work finishes or fails: `orchestrator` when a PM started it for a
   * request the orchestrator passed on (§8.2), so the result reaches whoever asked for it.
   */
  reportTo: z.literal("orchestrator").optional(),
});
export type StartedBy = z.infer<typeof StartedBy>;

/**
 * Stable identifier of *what* the work is, used for conflict detection:
 * `automation:security-audit`, `issue:142`, `pr:57`, or one derived from the request.
 */
export const WorkKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z][a-z0-9_-]*:\S.*$/, "Expected <kind>:<id>, e.g. issue:142");
export type WorkKey = z.infer<typeof WorkKey>;

/** Where the work happens: a project, optionally narrowed to paths or a named area. */
export const WorkScope = z.object({
  projectId: Id.nullable(),
  paths: z.array(z.string()).optional(),
  /** Free-form area, e.g. `auth`, `ui`, `dependencies`. */
  area: z.string().optional(),
});
export type WorkScope = z.infer<typeof WorkScope>;

/** The latest `report_progress` call. */
export const WorkProgress = z.object({
  text: z.string(),
  at: Timestamp,
});
export type WorkProgress = z.infer<typeof WorkProgress>;

/** Fields every unit of work carries (spread into `Session` and `AutomationRun`). */
export const workFields = {
  startedBy: StartedBy,
  /** One line describing the work. */
  purpose: z.string(),
  workKey: WorkKey,
  scope: WorkScope,
  progress: WorkProgress.nullable(),
};

/** Compact description of running or queued work, used in conflicts and status digests. */
export const WorkSummary = z.object({
  kind: z.enum(["session", "automation_run"]),
  /** Session id or automation run id. */
  id: Id,
  /** Session doing the work, when there is one. */
  sessionId: Id.nullable(),
  projectId: Id.nullable(),
  ...workFields,
  /** Session status or automation run status. */
  status: z.string(),
  startedAt: Timestamp,
});
export type WorkSummary = z.infer<typeof WorkSummary>;

/**
 * Result of anything that starts work (`start_session`, `run_automation`, scheduled triggers).
 * On `conflict` nothing was started; the caller picks a `ConflictResolution`.
 */
export const StartWorkResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("started"),
    sessionId: Id,
    automationRunId: Id.optional(),
  }),
  z.object({
    status: z.literal("conflict"),
    /** Running or queued work with the same `workKey` or an overlapping scope. */
    existing: z.array(WorkSummary).min(1),
    /** Inbox conflict item persisted for this attempt (user starts), resolvable later. */
    conflictId: Id.optional(),
  }),
]);
export type StartWorkResult = z.infer<typeof StartWorkResult>;

/**
 * How to proceed after a conflict:
 * - `wait`: queue behind the existing work.
 * - `skip`: don't start anything.
 * - `join`: send the request to the existing session as a follow-up.
 * - `force`: start anyway (a reason is required and recorded).
 */
export const ConflictResolution = z.enum(["wait", "skip", "join", "force"]);
export type ConflictResolution = z.infer<typeof ConflictResolution>;

/** A caller's decision on a conflict, passed back when retrying the start. */
export const ConflictDecision = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("wait"), behindId: Id.optional() }),
  z.object({ resolution: z.literal("skip") }),
  z.object({ resolution: z.literal("join"), sessionId: Id }),
  z.object({ resolution: z.literal("force"), reason: z.string().trim().min(1) }),
]);
export type ConflictDecision = z.infer<typeof ConflictDecision>;

/** Overlap policy for scheduled triggers when the previous run is still going (§8.4, §10). */
export const OverlapPolicy = z.enum(["skip-if-running", "queue", "run-anyway"]);
export type OverlapPolicy = z.infer<typeof OverlapPolicy>;

/** An upcoming scheduled automation run (the "Next" in a project's Now / Next strip). */
export const ScheduledRun = z.object({
  automationId: Id,
  projectId: Id.nullable(),
  name: z.string(),
  workKey: WorkKey,
  at: Timestamp,
  /** True when a PM chose to skip this occurrence (`skip_next_run`). */
  skipped: z.boolean().default(false),
});
export type ScheduledRun = z.infer<typeof ScheduledRun>;
