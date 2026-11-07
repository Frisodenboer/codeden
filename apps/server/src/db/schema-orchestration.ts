import type { ConflictRecord, Notice } from "@codeden/contracts";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Orchestration projections (§8): typed notices and persisted conflicts. Written in the same
 * transaction as their events (`notice.created`, `notice.delivered`, `conflict.created`).
 */

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const notices = sqliteTable(
  "notices",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    target: text("target").notNull(),
    projectId: text("project_id"),
    sessionId: text("session_id"),
    notice: json<Notice>("notice").notNull(),
    createdAt: text("created_at").notNull(),
    deliveredAt: text("delivered_at"),
  },
  (t) => [
    index("notices_target").on(t.target, t.projectId, t.deliveredAt),
    index("notices_created").on(t.createdAt),
  ],
);

/** Conflict details; the status lives on the `conflict` inbox item with the same id. */
export const conflicts = sqliteTable(
  "conflicts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    record: json<ConflictRecord>("record").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("conflicts_project").on(t.projectId)],
);
