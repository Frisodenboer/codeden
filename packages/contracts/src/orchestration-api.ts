import { z } from "zod";
import { StartSessionResponse } from "./api";
import { Id, ReasoningEffort } from "./common";
import { InboxItemStatus } from "./entities/inbox";
import { Session } from "./entities/session";
import { UserInput } from "./input";
import { ConflictRecord, NoticeTarget } from "./orchestration";
import { ConflictDecision } from "./work";

/** HTTP shapes for the orchestrator and PM chats, notices and conflicts (`/api/orchestration`). */

/** `GET|POST /api/orchestration/orchestrator` and `.../projects/:id/pm`. */
export const RoleSessionResponse = z.object({ session: Session.nullable() });
export type RoleSessionResponse = z.infer<typeof RoleSessionResponse>;

/** `POST .../orchestrator/messages` and `.../projects/:id/pm/messages`. */
export const RoleMessageRequest = z.object({
  input: UserInput,
  whenBusy: z.enum(["queue", "steer", "reject"]).default("queue"),
});
export type RoleMessageRequest = z.infer<typeof RoleMessageRequest>;
export type RoleMessageRequestInit = z.input<typeof RoleMessageRequest>;

export const RoleMessageResponse = z.object({
  sessionId: Id,
  status: z.enum(["sent", "queued", "steered"]),
});
export type RoleMessageResponse = z.infer<typeof RoleMessageResponse>;

/** `GET /api/orchestration/notices` query. */
export const ListNoticesQuery = z.object({
  projectId: Id.optional(),
  target: NoticeTarget.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListNoticesQuery = z.infer<typeof ListNoticesQuery>;

/** `GET /api/conflicts` query. Defaults to open conflicts. */
export const ListConflictsQuery = z.object({
  status: InboxItemStatus.optional(),
  projectId: Id.optional(),
});
export type ListConflictsQuery = z.infer<typeof ListConflictsQuery>;

/** `POST /api/conflicts/:id/resolve`: the decision (wait, skip, join or force with a reason). */
export const ResolveConflictRequest = ConflictDecision;
export type ResolveConflictRequest = z.infer<typeof ResolveConflictRequest>;

export const ResolveConflictResponse = z.object({
  conflict: ConflictRecord,
  result: StartSessionResponse,
});
export type ResolveConflictResponse = z.infer<typeof ResolveConflictResponse>;

/**
 * `PATCH /api/sessions/:id`: change the model or effort mid-session. Applied on the next turn
 * (a running turn keeps its settings). `null` returns to the role default.
 */
export const UpdateSessionRequest = z
  .object({
    model: z.string().min(1).nullable().optional(),
    effort: ReasoningEffort.nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((r) => r.model !== undefined || r.effort !== undefined || r.title !== undefined, {
    message: "Nothing to change",
  });
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequest>;
