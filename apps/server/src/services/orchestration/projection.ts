import type { EventOf } from "@codeden/contracts";
import { eq, inArray } from "drizzle-orm";
import { conflicts, notices } from "../../db/schema-orchestration";
import type { Tx } from "../../events/projection-db";

type OrchestrationEvent = EventOf<
  "notice.created" | "notice.delivered" | "notice.returned" | "conflict.created"
>;

/** Project orchestration events (§8) inside the append transaction, so they can be rebuilt. */
export function applyOrchestrationProjection(tx: Tx, e: OrchestrationEvent): void {
  switch (e.type) {
    case "notice.created": {
      const { notice } = e.payload;
      const row = {
        id: notice.id,
        type: notice.type,
        target: notice.target,
        projectId: notice.projectId,
        sessionId: notice.sessionId,
        notice,
        createdAt: notice.createdAt,
        deliveredAt: notice.deliveredAt,
      };
      tx.insert(notices).values(row).onConflictDoUpdate({ target: notices.id, set: row }).run();
      return;
    }
    case "notice.delivered": {
      if (e.payload.noticeIds.length === 0) return;
      const rows = tx.select().from(notices).where(inArray(notices.id, e.payload.noticeIds)).all();
      for (const row of rows) {
        if (row.deliveredAt) continue;
        tx.update(notices)
          .set({ deliveredAt: e.payload.at, notice: { ...row.notice, deliveredAt: e.payload.at } })
          .where(eq(notices.id, row.id))
          .run();
      }
      return;
    }
    case "notice.returned": {
      if (e.payload.noticeIds.length === 0) return;
      const rows = tx.select().from(notices).where(inArray(notices.id, e.payload.noticeIds)).all();
      for (const row of rows) {
        if (!row.deliveredAt) continue;
        tx.update(notices)
          .set({ deliveredAt: null, notice: { ...row.notice, deliveredAt: null } })
          .where(eq(notices.id, row.id))
          .run();
      }
      return;
    }
    case "conflict.created": {
      const { conflict } = e.payload;
      tx.insert(conflicts)
        .values({
          id: conflict.id,
          projectId: conflict.projectId,
          record: conflict,
          createdAt: conflict.createdAt,
        })
        .onConflictDoNothing()
        .run();
      return;
    }
  }
}
