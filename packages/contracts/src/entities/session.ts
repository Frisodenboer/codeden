import { z } from "zod";
import {
  AutonomyLevel,
  ErrorInfo,
  GitHubIssueRef,
  GitHubPrRef,
  Id,
  ProviderId,
  ReasoningEffort,
  Role,
  Timestamp,
} from "../common";
import { Item } from "../items";

/**
 * Session lifecycle.
 * - `created`: row exists, nothing started on a runner yet.
 * - `starting`: workspace prepared / provider process launching.
 * - `running`: a turn is in progress.
 * - `waiting`: blocked on the user (approval or question).
 * - `idle`: between turns, ready for input.
 * - `interrupted`: cut off (runner restart, crash); resumable.
 * - `completed` / `failed` / `stopped`: terminal.
 */
export const SessionStatus = z.enum([
  "created",
  "starting",
  "running",
  "waiting",
  "idle",
  "interrupted",
  "completed",
  "failed",
  "stopped",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** An agent session of any role (§8.1). */
export const Session = z.object({
  id: Id,
  /** Null for the orchestrator. */
  projectId: Id.nullable(),
  role: Role,
  /** The session that started this one (PM for agents, orchestrator for PMs). */
  parentSessionId: Id.nullable(),
  title: z.string().nullable(),
  provider: ProviderId,
  model: z.string().nullable(),
  effort: ReasoningEffort.nullable(),
  autonomy: AutonomyLevel,
  status: SessionStatus,
  /** Directory the agent runs in. */
  cwd: z.string(),
  /** Set when the session owns a worktree under `~/.codeden/wt/`. */
  worktreePath: z.string().nullable(),
  branch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  issue: GitHubIssueRef.nullable(),
  pr: GitHubPrRef.nullable(),
  /** Provider resume token (session/thread id). */
  resumeToken: z.string().nullable(),
  /** Runner currently hosting the session. */
  runnerId: z.string().nullable(),
  automationRunId: Id.nullable(),
  /** The session's root thread, once the provider started it. */
  rootThreadId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  endedAt: Timestamp.nullable(),
});
export type Session = z.infer<typeof Session>;

/** Thread projection (§6 `threads`). */
export const Thread = z.object({
  id: Id,
  sessionId: Id,
  parentThreadId: Id.nullable(),
  parentItemId: Id.nullable(),
  title: z.string().nullable(),
  agentType: z.string().nullable(),
  createdAt: Timestamp,
});
export type Thread = z.infer<typeof Thread>;

export const TurnStatus = z.enum(["running", "completed", "failed", "interrupted"]);
export type TurnStatus = z.infer<typeof TurnStatus>;

/** Turn projection (§6 `turns`). */
export const Turn = z.object({
  id: Id,
  threadId: Id,
  sessionId: Id,
  status: TurnStatus,
  startedAt: Timestamp,
  completedAt: Timestamp.nullable(),
  error: ErrorInfo.nullable(),
});
export type Turn = z.infer<typeof Turn>;

/** Item projection (§6 `items`): the latest state of an item plus its location. */
export const ItemRecord = z.object({
  sessionId: Id,
  threadId: Id,
  turnId: Id,
  /** Order within the thread. */
  position: z.int().nonnegative(),
  item: Item,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ItemRecord = z.infer<typeof ItemRecord>;
