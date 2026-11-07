import {
  type ItemOf,
  type ItemRecord,
  type ListSessionsQuery,
  type Session,
  SessionStartMeta,
  type ThreadItemsPage,
  type ThreadItemsQuery,
  type Usage,
  type UserInput,
  type WorkSummary,
  type WorkspaceRequest,
} from "@codeden/contracts";
import { and, asc, desc, eq, gt, inArray, lt, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToItemRecord, rowToSession } from "../../db/rows";
import { automationRuns, items, sessions } from "../../db/schema";
import type { EventStore } from "../../events/store";
import { notFound } from "../errors";
import { ACTIVE_RUN_STATUSES, ACTIVE_SESSION_STATUSES } from "./conflicts";

/** What a queued session needs to start later (kept with its start metadata). */
export interface PendingStart {
  input?: UserInput;
  workspace: WorkspaceRequest;
}

/** Start metadata as stored: the public `SessionStartMeta` plus a pending start. */
export type StoredStartMeta = SessionStartMeta & { pending?: PendingStart | null };

/** Session rows and transcript reads. Every session change goes through the event log. */
export class SessionRepo {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
  ) {}

  find(
    id: string,
  ): { session: Session; usage: Usage | null; startMeta: StoredStartMeta | null } | undefined {
    const row = this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return undefined;
    return {
      session: rowToSession(row),
      usage: row.usage ?? null,
      startMeta: row.startMeta ?? null,
    };
  }

  get(id: string): Session {
    const found = this.find(id);
    if (!found) throw notFound(`No session ${id}`, "session_not_found");
    return found.session;
  }

  /** Insert a new session (and its start metadata) in one transaction. */
  create(session: Session, startMeta: StoredStartMeta): void {
    this.store.append(
      [{ type: "session.created", sessionId: session.id, payload: { session } }],
      (tx) => {
        tx.update(sessions).set({ startMeta }).where(eq(sessions.id, session.id)).run();
      },
    );
  }

  /**
   * Apply `change` to the current row and append `session.updated` when it changed. Synchronous
   * end to end, so there is no read-modify-write race with event ingestion.
   */
  update(id: string, change: (s: Session) => Session): Session {
    const current = this.get(id);
    const next = change(current);
    if (next === current) return current;
    const session = { ...next, updatedAt: new Date().toISOString() };
    this.store.append([{ type: "session.updated", sessionId: id, payload: { session } }]);
    return session;
  }

  setStartMeta(id: string, change: (meta: StoredStartMeta | null) => StoredStartMeta): void {
    const meta = change(this.find(id)?.startMeta ?? null);
    this.db.update(sessions).set({ startMeta: meta }).where(eq(sessions.id, id)).run();
  }

  /** Public view of the start metadata. */
  publicStartMeta(meta: StoredStartMeta | null): SessionStartMeta | null {
    return meta ? SessionStartMeta.parse(meta) : null;
  }

  list(query: ListSessionsQuery = {}): Session[] {
    const conditions: SQL[] = [];
    if (query.projectId) conditions.push(eq(sessions.projectId, query.projectId));
    if (query.status?.length) conditions.push(inArray(sessions.status, query.status));
    if (query.workKey) conditions.push(eq(sessions.workKey, query.workKey));
    if (query.role) conditions.push(eq(sessions.role, query.role));
    return this.db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.createdAt))
      .limit(1000)
      .all()
      .map(rowToSession);
  }

  /** Queued sessions, oldest first. */
  queued(): Session[] {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.status, "queued"))
      .orderBy(asc(sessions.createdAt))
      .all()
      .map(rowToSession);
  }

  /** Running or queued work in a project: sessions and automation runs (§8.4). */
  activeWork(projectId: string | null): WorkSummary[] {
    const sessionRows = this.db
      .select()
      .from(sessions)
      .where(
        and(
          projectId === null ? undefined : eq(sessions.projectId, projectId),
          inArray(sessions.status, [...ACTIVE_SESSION_STATUSES]),
        ),
      )
      .orderBy(asc(sessions.createdAt))
      .all()
      .map(rowToSession)
      .filter((s) => s.projectId === projectId);
    const runRows = this.db
      .select()
      .from(automationRuns)
      .where(inArray(automationRuns.status, [...ACTIVE_RUN_STATUSES]))
      .all()
      .filter((r) => r.projectId === projectId);
    return [
      ...sessionRows.map(
        (s): WorkSummary => ({
          kind: "session",
          id: s.id,
          sessionId: s.id,
          projectId: s.projectId,
          startedBy: s.startedBy,
          purpose: s.purpose,
          workKey: s.workKey,
          scope: s.scope,
          progress: s.progress,
          status: s.status,
          startedAt: s.createdAt,
        }),
      ),
      ...runRows.map(
        (r): WorkSummary => ({
          kind: "automation_run",
          id: r.id,
          sessionId: r.sessionId,
          projectId: r.projectId,
          startedBy: r.startedBy,
          purpose: r.purpose,
          workKey: r.workKey,
          scope: r.scope,
          progress: r.progress,
          status: r.status,
          startedAt: r.startedAt,
        }),
      ),
    ];
  }

  item(sessionId: string, itemId: string): ItemRecord | undefined {
    const row = this.db
      .select()
      .from(items)
      .where(and(eq(items.sessionId, sessionId), eq(items.id, itemId)))
      .get();
    return row ? rowToItemRecord(row) : undefined;
  }

  /** A page of a thread's items by position (newest page by default). */
  threadPage(sessionId: string, threadId: string, q: ThreadItemsQuery): ThreadItemsPage {
    const base = [eq(items.sessionId, sessionId), eq(items.threadId, threadId)];
    const newestFirst = q.after === undefined;
    const rows = this.db
      .select()
      .from(items)
      .where(
        and(
          ...base,
          q.before !== undefined ? lt(items.position, q.before) : undefined,
          q.after !== undefined ? gt(items.position, q.after) : undefined,
        ),
      )
      .orderBy(newestFirst ? desc(items.position) : asc(items.position))
      .limit(q.limit + 1)
      .all();
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit).map(rowToItemRecord);
    if (newestFirst) page.reverse();
    const first = page[0]?.position;
    const last = page.at(-1)?.position;
    const exists = (cond: SQL) =>
      this.db
        .select({ id: items.id })
        .from(items)
        .where(and(...base, cond))
        .limit(1)
        .get() !== undefined;
    return {
      threadId,
      items: page,
      hasMoreBefore: newestFirst ? more : first !== undefined && exists(lt(items.position, first)),
      hasMoreAfter: newestFirst ? last !== undefined && exists(gt(items.position, last)) : more,
    };
  }

  /** Follow-ups of the latest root-thread turn that produced some (§7.5). */
  latestFollowups(session: Session): ItemOf<"followups"> | null {
    if (!session.rootThreadId) return null;
    const row = this.db
      .select()
      .from(items)
      .where(
        and(
          eq(items.sessionId, session.id),
          eq(items.threadId, session.rootThreadId),
          eq(items.kind, "followups"),
        ),
      )
      .orderBy(desc(items.position))
      .limit(1)
      .get();
    return row?.data.kind === "followups" ? row.data : null;
  }
}
