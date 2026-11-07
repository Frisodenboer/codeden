import {
  CODEDEN_VERSION,
  type HealthResponse,
  type SessionSnapshot,
  type SettingsPatch,
  type Snapshot,
} from "@codeden/contracts";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { rowToAutomation, rowToItemRecord, rowToSession, rowToThread, rowToTurn } from "../db/rows";
import { automations, items, sessions, threads, turns } from "../db/schema";
import type { AppServices } from "../services/container";
import { badRequest, notFound } from "../services/errors";
import { previewRecord } from "../services/sessions/preview";
import { agentConfigRoutes, sessionAgentConfigRoutes } from "./agent-config";
import { browserRoutes, sessionBrowserRoutes } from "./browser";
import { imageRoutes } from "./images";
import { inboxRoutes } from "./inbox";
import { projectRoutes } from "./projects";
import { sessionRoutes } from "./sessions";
import { artifactRoutes, fileRoutes, secretRoutes, setupRoutes } from "./system";
import { errorResponse } from "./validate";
import { utilityRoutes, workbenchRoutes } from "./workbench";

export interface ApiContext {
  services: AppServices;
  runnerStatus: () => Snapshot["runner"];
  startedAt: number;
  /** Stop the server (and optionally the runner) after the response is sent. */
  shutdown: (opts: { stopRunner: boolean }) => void;
  log?: (message: string) => void;
}

/**
 * HTTP API mounted at `/api`. Routes are chained so `AppType` carries their types for the
 * Hono RPC client used by the web app. Request and response shapes live in
 * `@codeden/contracts` (`api.ts`).
 */
export function createApi(ctx: ApiContext) {
  const s = ctx.services;
  return new Hono()
    .onError((error, c) => errorResponse(error, c, ctx.log))
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
    .get("/sessions/:id/snapshot", (c) => c.json(buildSessionSnapshot(s, c.req.param("id"))))
    .route("/projects", projectRoutes(s))
    .route("/sessions", sessionRoutes(s))
    .route("/sessions", workbenchRoutes(s))
    .route("/sessions", sessionBrowserRoutes(s))
    .route("/browser", browserRoutes(s))
    .route("/images", imageRoutes(s))
    .route("/agent-config", agentConfigRoutes(s))
    .route("/sessions", sessionAgentConfigRoutes(s))
    .route("/utility", utilityRoutes(s))
    .route("/inbox", inboxRoutes(s))
    .route("/setup", setupRoutes(s))
    .route("/artifacts", artifactRoutes(s))
    .route("/secrets", secretRoutes(s))
    .route("/", fileRoutes(s))
    .get("/settings", (c) => c.json(s.settings.get()))
    .patch("/settings", async (c) => {
      const patch = (await c.req.json().catch(() => undefined)) as SettingsPatch | undefined;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw badRequest("Expected a JSON object");
      }
      let settings: ReturnType<typeof s.settings.update>;
      try {
        settings = s.settings.update(patch);
      } catch (error) {
        return c.json({ error: { code: "invalid_settings", message: String(error) } }, 400);
      }
      s.store.append([{ type: "settings.updated", sessionId: null, payload: { settings } }]);
      if (patch.imageGeneration) s.images.invalidate();
      return c.json(settings);
    })
    .post("/shutdown", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { stopRunner?: boolean };
      ctx.shutdown({ stopRunner: body.stopRunner === true });
      return c.json({ ok: true as const });
    });
}

export type ApiRoutes = ReturnType<typeof createApi>;

function buildSnapshot(ctx: ApiContext): Snapshot {
  const s = ctx.services;
  // Read the head first: anything appended later arrives through the WebSocket.
  const seq = s.store.headSeq();
  return {
    seq,
    serverVersion: CODEDEN_VERSION,
    generatedAt: new Date().toISOString(),
    settings: s.settings.get(),
    projects: s.projects.list(),
    sessions: s.db.select().from(sessions).orderBy(asc(sessions.createdAt)).all().map(rowToSession),
    inbox: s.inbox.list({ status: "open" }),
    automations: s.db.select().from(automations).all().map(rowToAutomation),
    scheduled: [],
    runner: ctx.runnerStatus(),
  };
}

/** A whole transcript in one response (prefer the paginated thread items route). */
function buildSessionSnapshot(s: AppServices, sessionId: string): SessionSnapshot {
  const seq = s.store.headSeq();
  const row = s.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) throw notFound("No such session", "session_not_found");
  return {
    seq,
    session: rowToSession(row),
    threads: s.db
      .select()
      .from(threads)
      .where(eq(threads.sessionId, sessionId))
      .all()
      .map(rowToThread),
    turns: s.db.select().from(turns).where(eq(turns.sessionId, sessionId)).all().map(rowToTurn),
    items: s.db
      .select()
      .from(items)
      .where(eq(items.sessionId, sessionId))
      .orderBy(asc(items.threadId), asc(items.position))
      .all()
      .map((r) => previewRecord(rowToItemRecord(r))),
  };
}
