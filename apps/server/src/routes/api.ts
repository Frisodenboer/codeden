import {
  CODEDEN_VERSION,
  type HealthResponse,
  type SessionSnapshot,
  type SettingsPatch,
  type Snapshot,
} from "@codeden/contracts";
import { asc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import {
  rowToAutomation,
  rowToInbox,
  rowToProject,
  rowToSession,
  rowToThread,
  rowToTurn,
} from "../db/rows";
import { automations, inboxItems, items, projects, sessions, threads, turns } from "../db/schema";
import type { EventStore } from "../events/store";
import type { RunnerClient } from "../runner/client";
import type { SettingsStore } from "../settings-store";

export interface ApiContext {
  db: Db;
  store: EventStore;
  settings: SettingsStore;
  runner: () => RunnerClient | undefined;
  runnerStatus: () => Snapshot["runner"];
  startedAt: number;
  /** Stop the server (and optionally the runner) after the response is sent. */
  shutdown: (opts: { stopRunner: boolean }) => void;
}

/**
 * HTTP API mounted at `/api`. Routes are chained so `AppType` carries their types for the
 * Hono RPC client used by the web app.
 */
export function createApi(ctx: ApiContext) {
  return new Hono()
    .get("/health", (c) => {
      const body: HealthResponse = {
        ok: true,
        name: "codeden",
        version: CODEDEN_VERSION,
        uptimeSec: (Date.now() - ctx.startedAt) / 1000,
      };
      return c.json(body);
    })
    .get("/snapshot", (c) => c.json(buildSnapshot(ctx)))
    .get("/sessions/:id/snapshot", (c) => {
      const snapshot = buildSessionSnapshot(ctx, c.req.param("id"));
      if (!snapshot)
        return c.json({ error: { code: "not_found", message: "No such session" } }, 404);
      return c.json(snapshot);
    })
    .get("/settings", (c) => c.json(ctx.settings.get()))
    .patch("/settings", async (c) => {
      const patch = (await c.req.json().catch(() => undefined)) as SettingsPatch | undefined;
      if (!patch || typeof patch !== "object") {
        return c.json({ error: { code: "bad_request", message: "Expected a JSON object" } }, 400);
      }
      try {
        const settings = ctx.settings.update(patch);
        ctx.store.append([{ type: "settings.updated", sessionId: null, payload: { settings } }]);
        return c.json(settings);
      } catch (error) {
        return c.json({ error: { code: "invalid_settings", message: String(error) } }, 400);
      }
    })
    .post("/shutdown", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { stopRunner?: boolean };
      ctx.shutdown({ stopRunner: body.stopRunner === true });
      return c.json({ ok: true as const });
    });
}

export type ApiRoutes = ReturnType<typeof createApi>;

function buildSnapshot(ctx: ApiContext): Snapshot {
  const { db } = ctx;
  // Read the head first: anything appended later arrives through the WebSocket.
  const seq = ctx.store.headSeq();
  return {
    seq,
    serverVersion: CODEDEN_VERSION,
    generatedAt: new Date().toISOString(),
    settings: ctx.settings.get(),
    projects: db.select().from(projects).orderBy(asc(projects.name)).all().map(rowToProject),
    sessions: db.select().from(sessions).orderBy(asc(sessions.createdAt)).all().map(rowToSession),
    inbox: db
      .select()
      .from(inboxItems)
      .where(ne(inboxItems.status, "resolved"))
      .orderBy(asc(inboxItems.createdAt))
      .all()
      .map(rowToInbox),
    automations: db.select().from(automations).all().map(rowToAutomation),
    scheduled: [],
    runner: ctx.runnerStatus(),
  };
}

function buildSessionSnapshot(ctx: ApiContext, sessionId: string): SessionSnapshot | undefined {
  const { db } = ctx;
  const seq = ctx.store.headSeq();
  const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) return undefined;
  return {
    seq,
    session: rowToSession(row),
    threads: db
      .select()
      .from(threads)
      .where(eq(threads.sessionId, sessionId))
      .all()
      .map(rowToThread),
    turns: db.select().from(turns).where(eq(turns.sessionId, sessionId)).all().map(rowToTurn),
    items: db
      .select()
      .from(items)
      .where(eq(items.sessionId, sessionId))
      .orderBy(asc(items.threadId), asc(items.position))
      .all()
      .map((r) => ({
        sessionId: r.sessionId,
        threadId: r.threadId,
        turnId: r.turnId,
        position: r.position,
        item: r.data,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
  };
}
