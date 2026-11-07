import type { AgentEvent, EventEnvelope, Item, ItemDelta } from "@codeden/contracts";
import { and, count, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { automationToRow, inboxToRow, projectToRow, runToRow, sessionToRow } from "../db/rows";
import {
  artifacts,
  automationRuns,
  automations,
  inboxItems,
  items,
  projects,
  sessions,
  threads,
  turns,
} from "../db/schema";

/** A transaction handle from `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Update projections for one stored event, inside the append transaction (§6), so
 * projections can always be rebuilt by replaying the log through this function.
 */
export function applyProjection(tx: Tx, e: EventEnvelope): void {
  switch (e.type) {
    case "project.created":
    case "project.updated": {
      const row = projectToRow(e.payload.project);
      tx.insert(projects).values(row).onConflictDoUpdate({ target: projects.id, set: row }).run();
      return;
    }
    case "project.archived":
      tx.update(projects)
        .set({ archivedAt: e.ts, updatedAt: e.ts })
        .where(eq(projects.id, e.payload.projectId))
        .run();
      return;
    case "session.created":
    case "session.updated": {
      const row = sessionToRow(e.payload.session);
      tx.insert(sessions).values(row).onConflictDoUpdate({ target: sessions.id, set: row }).run();
      return;
    }
    case "inbox.created":
    case "inbox.updated": {
      const row = inboxToRow(e.payload.item);
      tx.insert(inboxItems)
        .values(row)
        .onConflictDoUpdate({ target: inboxItems.id, set: row })
        .run();
      return;
    }
    case "automation.saved": {
      const row = automationToRow(e.payload.automation);
      tx.insert(automations)
        .values(row)
        .onConflictDoUpdate({ target: automations.id, set: row })
        .run();
      return;
    }
    case "automation.deleted":
      tx.delete(automations).where(eq(automations.id, e.payload.automationId)).run();
      return;
    case "automation_run.updated": {
      const row = runToRow(e.payload.run);
      tx.insert(automationRuns)
        .values(row)
        .onConflictDoUpdate({ target: automationRuns.id, set: row })
        .run();
      return;
    }
    case "artifact.created":
      tx.insert(artifacts).values(e.payload.artifact).onConflictDoNothing().run();
      return;
    case "settings.updated":
    case "runner.connected":
    case "runner.disconnected":
      return;
    default:
      applyAgentEvent(tx, e.sessionId, e.payload, e.ts);
  }
}

function applyAgentEvent(tx: Tx, sessionId: string, event: AgentEvent, ts: string): void {
  switch (event.type) {
    case "session.updated": {
      const set: Partial<typeof sessions.$inferInsert> = { updatedAt: ts };
      if (event.resumeToken !== undefined) set.resumeToken = event.resumeToken;
      if (event.model !== undefined) set.model = event.model;
      if (event.title !== undefined) set.title = event.title;
      tx.update(sessions).set(set).where(eq(sessions.id, sessionId)).run();
      return;
    }
    case "thread.started": {
      const { thread } = event;
      tx.insert(threads)
        .values({
          sessionId,
          id: thread.id,
          parentThreadId: thread.parentThreadId ?? null,
          parentItemId: thread.parentItemId ?? null,
          title: thread.title ?? null,
          agentType: thread.agentType ?? null,
          createdAt: ts,
        })
        .onConflictDoNothing()
        .run();
      if (!thread.parentThreadId) {
        tx.update(sessions)
          .set({ rootThreadId: thread.id })
          .where(eq(sessions.id, sessionId))
          .run();
      }
      return;
    }
    case "turn.started":
      tx.insert(turns)
        .values({
          sessionId,
          id: event.turnId,
          threadId: event.threadId,
          status: "running",
          startedAt: ts,
          completedAt: null,
          error: null,
        })
        .onConflictDoNothing()
        .run();
      return;
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted": {
      const status =
        event.type === "turn.completed"
          ? "completed"
          : event.type === "turn.failed"
            ? "failed"
            : "interrupted";
      tx.update(turns)
        .set({
          status,
          completedAt: ts,
          error: event.type === "turn.failed" ? event.error : null,
        })
        .where(and(eq(turns.sessionId, sessionId), eq(turns.id, event.turnId)))
        .run();
      return;
    }
    case "item.started":
    case "item.updated":
    case "item.completed":
      upsertItem(tx, sessionId, event.threadId, event.turnId, event.item, ts);
      return;
    case "item.delta": {
      const where = and(eq(items.sessionId, sessionId), eq(items.id, event.itemId));
      const row = tx.select({ data: items.data }).from(items).where(where).get();
      if (!row) return;
      tx.update(items)
        .set({ data: applyDelta(row.data, event.delta), updatedAt: ts })
        .where(where)
        .run();
      return;
    }
    case "usage.updated":
      return;
  }
}

function upsertItem(
  tx: Tx,
  sessionId: string,
  threadId: string,
  turnId: string,
  item: Item,
  ts: string,
): void {
  const existing = tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.sessionId, sessionId), eq(items.id, item.id)))
    .get();
  if (existing) {
    tx.update(items)
      .set({ kind: item.kind, status: item.status, data: item, updatedAt: ts })
      .where(and(eq(items.sessionId, sessionId), eq(items.id, item.id)))
      .run();
    return;
  }
  const position =
    tx
      .select({ n: count() })
      .from(items)
      .where(and(eq(items.sessionId, sessionId), eq(items.threadId, threadId)))
      .get()?.n ?? 0;
  tx.insert(items)
    .values({
      sessionId,
      id: item.id,
      threadId,
      turnId,
      position,
      kind: item.kind,
      status: item.status,
      data: item,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
}

/** Apply an incremental delta to an item (pure). Unknown combinations leave the item unchanged. */
export function applyDelta(item: Item, delta: ItemDelta): Item {
  switch (delta.type) {
    case "text":
      if (item.kind === "assistant_message" || item.kind === "reasoning" || item.kind === "plan") {
        return { ...item, text: item.text + delta.text };
      }
      return item;
    case "reasoning_summary":
      return item.kind === "reasoning"
        ? { ...item, summary: (item.summary ?? "") + delta.text }
        : item;
    case "tool_output":
      if (item.kind !== "tool_call") return item;
      return {
        ...item,
        output: {
          text: (item.output?.text ?? "") + delta.text,
          truncated: item.output?.truncated ?? false,
        },
      };
    case "tool_input":
      return item;
  }
}
