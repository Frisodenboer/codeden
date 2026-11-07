import {
  ListConflictsQuery,
  ListNoticesQuery,
  ResolveConflictRequest,
  RoleMessageRequest,
  type RoleMessageResponse,
  type RoleSessionResponse,
} from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/**
 * `/api/orchestration`: the orchestrator and PM chats (§8.1), notices, digests.
 * Messages go through the same path as wakes, so every one carries a fresh status digest.
 */
export function orchestrationRoutes(s: AppServices) {
  const o = s.orchestration;
  const pmSession = (projectId: string): RoleSessionResponse => {
    s.projects.get(projectId);
    return { session: o.roles.find("pm", projectId) ?? null };
  };
  return new Hono()
    .get("/orchestrator", (c) =>
      c.json<RoleSessionResponse>({ session: o.roles.find("orchestrator", null) ?? null }),
    )
    .post("/orchestrator", async (c) =>
      c.json<RoleSessionResponse>({ session: await o.roles.ensure("orchestrator", null) }),
    )
    .post("/orchestrator/messages", jsonBody(RoleMessageRequest), async (c) => {
      const { input, whenBusy } = c.req.valid("json");
      const body: RoleMessageResponse = await o.sendToRole("orchestrator", null, input, whenBusy);
      return c.json(body);
    })
    .get("/projects/:projectId/pm", (c) => c.json(pmSession(c.req.param("projectId"))))
    .post("/projects/:projectId/pm", async (c) => {
      const projectId = c.req.param("projectId");
      s.projects.get(projectId);
      return c.json<RoleSessionResponse>({ session: await o.roles.ensure("pm", projectId) });
    })
    .post("/projects/:projectId/pm/messages", jsonBody(RoleMessageRequest), async (c) => {
      const projectId = c.req.param("projectId");
      s.projects.get(projectId);
      const { input, whenBusy } = c.req.valid("json");
      const body: RoleMessageResponse = await o.sendToRole("pm", projectId, input, whenBusy);
      return c.json(body);
    })
    .get("/projects/:projectId/status", (c) => c.json(o.projectStatus(c.req.param("projectId"))))
    .get("/overview", (c) => c.json(o.overview()))
    .get("/roles", (c) => c.json(o.roles.refs()))
    .get("/notices", queryOf(ListNoticesQuery), (c) =>
      c.json(o.notices.list(c.req.valid("query"))),
    );
}

/** `/api/conflicts`: persisted conflicts (§8.4) and their wait/skip/join/force resolution. */
export function conflictRoutes(s: AppServices) {
  const conflicts = s.orchestration.conflicts;
  return new Hono()
    .get("/", queryOf(ListConflictsQuery), (c) => c.json(conflicts.list(c.req.valid("query"))))
    .get("/:id", (c) => c.json(conflicts.get(c.req.param("id"))))
    .post("/:id/resolve", jsonBody(ResolveConflictRequest), async (c) =>
      c.json(await conflicts.resolve(c.req.param("id"), c.req.valid("json"))),
    );
}
