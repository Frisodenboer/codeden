import { z } from "zod";
import { GitHubIssueRef, GitHubPrRef, Id, JsonValue, Timestamp } from "../common";

/** What an inbox item asks of the user (§11.1). */
export const InboxItemKind = z.enum([
  "question",
  "approval",
  "pr_review",
  "run_failed",
  "triage",
  "automation_result",
  "message",
]);
export type InboxItemKind = z.infer<typeof InboxItemKind>;

export const InboxItemStatus = z.enum(["open", "resolved", "dismissed"]);
export type InboxItemStatus = z.infer<typeof InboxItemStatus>;

/** One thing waiting on the user. Links to its session, issue and PR and is answerable in place. */
export const InboxItem = z.object({
  id: Id,
  kind: InboxItemKind,
  status: InboxItemStatus,
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  title: z.string(),
  body: z.string().nullable(),
  projectId: Id.nullable(),
  sessionId: Id.nullable(),
  threadId: Id.nullable(),
  /** The transcript item (approval_request / user_question) this mirrors. */
  itemId: Id.nullable(),
  /** Provider request id to answer, for approvals and questions. */
  requestId: Id.nullable(),
  issue: GitHubIssueRef.nullable(),
  pr: GitHubPrRef.nullable(),
  automationRunId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
  /** How it was resolved (decision, answers, note). */
  resolution: JsonValue.nullable(),
});
export type InboxItem = z.infer<typeof InboxItem>;
