import type { ItemOf } from "@codeden/contracts";
import { and, eq } from "drizzle-orm";
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
