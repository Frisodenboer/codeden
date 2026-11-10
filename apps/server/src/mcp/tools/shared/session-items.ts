import type { ItemOf, Session } from "@codeden/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { items } from "../../../db/schema";

/** A session's question item (`ask_user` or the provider's own) by its request id. */
export function questionItem(
  db: Db,
  sessionId: string,
  requestId: string,
): ItemOf<"user_question"> | undefined {
  const rows = db
    .select()
    .from(items)
    .where(and(eq(items.sessionId, sessionId), eq(items.kind, "user_question")))
    .all();
  for (const row of rows) {
    if (row.data.kind === "user_question" && row.data.requestId === requestId) return row.data;
  }
  return undefined;
}

/** The latest non-empty assistant message on a session's root thread. */
export function lastAssistantMessage(db: Db, session: Session): string | null {
  if (!session.rootThreadId) return null;
  const rows = db
    .select()
    .from(items)
    .where(
      and(
        eq(items.sessionId, session.id),
        eq(items.threadId, session.rootThreadId),
        eq(items.kind, "assistant_message"),
      ),
    )
    .orderBy(desc(items.position))
    .limit(5)
    .all();
  for (const row of rows) {
    if (row.data.kind === "assistant_message" && row.data.text.trim()) return row.data.text.trim();
  }
  return null;
}
