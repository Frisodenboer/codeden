import { z } from "zod";
import { ScheduledRun } from "./work";

/**
 * The project file manager: browse and manage the files of a project's main checkout
 * (`project.path`). Listing and reading reuse the session file shapes (`SessionFileList`,
 * `SessionFileContent`, `SessionFileQuery`). Paths are relative to the project folder and use
 * `/` separators; nothing outside the folder and nothing inside `.git` can be changed.
 */

const RelPath = z.string().min(1).max(4096);

/** `POST /api/projects/:id/files/ops`: one change to the project folder. */
export const ProjectFileOp = z.discriminatedUnion("op", [
  /** Create an empty file; fails if something already exists at `path`. */
  z.object({ op: z.literal("createFile"), path: RelPath }),
  /** Create a folder (and missing parents); fails if something already exists at `path`. */
  z.object({ op: z.literal("createDir"), path: RelPath }),
  /** Rename or move a file or folder; fails if `to` already exists. */
  z.object({ op: z.literal("rename"), from: RelPath, to: RelPath }),
  /** Delete a file or a folder with everything in it. */
  z.object({ op: z.literal("delete"), path: RelPath }),
]);
export type ProjectFileOp = z.infer<typeof ProjectFileOp>;

export const ProjectFileOpResponse = z.object({
  ok: z.literal(true),
  /** The path the change produced (the new path for a rename), `/` separators. */
  path: z.string(),
});
export type ProjectFileOpResponse = z.infer<typeof ProjectFileOpResponse>;

/**
 * `GET /api/scheduled`: everything set to run later, across all projects — upcoming automation
 * runs and the pending wake-ups the orchestrator and PMs scheduled for themselves.
 */
export const ScheduledWakeup = z.object({
  id: z.string(),
  /** Who it wakes: the orchestrator, or a project's PM. */
  target: z.enum(["orchestrator", "pm"]),
  projectId: z.string().nullable(),
  at: z.string(),
  note: z.string(),
});
export type ScheduledWakeup = z.infer<typeof ScheduledWakeup>;

/**
 * Something planned inside a project folder rather than in CodeBench: a scheduled GitHub
 * Actions workflow, a queued Google Business Profile post (`scripts/gbp-posts.json`), or an
 * item from the project's `.codebench/plan.json`.
 */
export const PlannedItem = z.object({
  id: z.string(),
  projectId: z.string(),
  at: z.string(),
  source: z.enum(["workflow", "gbp", "plan"]),
  title: z.string(),
  detail: z.string().nullable(),
});
export type PlannedItem = z.infer<typeof PlannedItem>;

export const ScheduledOverview = z.object({
  /** Upcoming automation runs, soonest first. */
  runs: z.array(ScheduledRun),
  /** Pending wake-ups, soonest first. */
  wakeups: z.array(ScheduledWakeup),
  /** Plans found in the project folders, soonest first. */
  planned: z.array(PlannedItem).default([]),
});
export type ScheduledOverview = z.infer<typeof ScheduledOverview>;

/** `DELETE /api/scheduled/wakeups/:id` query: whose wake-up it is. */
export const CancelWakeupQuery = z.object({
  target: z.enum(["orchestrator", "pm"]),
  projectId: z.string().optional(),
});
export type CancelWakeupQuery = z.infer<typeof CancelWakeupQuery>;
