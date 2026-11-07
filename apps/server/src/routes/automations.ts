import {
  type Automation,
  AutomationProjectRequest,
  type AutomationProjectSettings,
  CreateAutomationRequest,
  ListAutomationRunsQuery,
  ListAutomationsQuery,
  RunAutomationRequest,
  SetAutomationEnabledRequest,
  StarterSetRequest,
  type StarterSetResponse,
  TriageDecisionRequest,
  UpcomingRunsQuery,
  UpdateAutomationProjectSettingsRequest,
  UpdateAutomationRequest,
} from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/** Item for one automation, scoped to a project when given. */
function itemOf(s: AppServices, automation: Automation, projectId?: string) {
  const found = s.automations
    .list(projectId)
    .automations.find((i) => i.automation.id === automation.id);
  return found ?? { automation, states: [], lastRun: null, path: null, readOnly: true };
}

/**
 * `/api/automations` (§10): definitions, enable/disable, run now, pause/resume/skip, runs
 * history, upcoming runs (the Now / Next strip), templates and triage decisions.
 */
export function automationRoutes(s: AppServices) {
  const a = s.automations;
  return new Hono()
    .get("/", queryOf(ListAutomationsQuery), (c) => c.json(a.list(c.req.valid("query").projectId)))
    .post("/", jsonBody(CreateAutomationRequest), (c) => {
      const created = a.definitions.create(c.req.valid("json"));
      a.refresh();
      return c.json(itemOf(s, created), 201);
    })
    .get("/templates", (c) => c.json(a.sources.templates()))
    .get("/upcoming", queryOf(UpcomingRunsQuery), (c) => {
      const q = c.req.valid("query");
      return c.json(a.listScheduledRuns(q.projectId ?? null, q.limit));
    })
    .get("/runs", queryOf(ListAutomationRunsQuery), (c) =>
      c.json(a.runs.list(c.req.valid("query"))),
    )
    .get("/runs/:runId", (c) => c.json(a.runs.get(c.req.param("runId"))))
    .post("/runs/:runId/cancel", async (c) => {
      const run = a.runs.get(c.req.param("runId"));
      await a.cancelQueuedRun(run.id, run.projectId ?? "");
      return c.json(a.runs.get(run.id));
    })
    .post("/reload", (c) => {
      a.sources.reload();
      a.refresh();
      return c.json(a.list());
    })
    .post("/triage/:itemId/accept", jsonBody(TriageDecisionRequest), async (c) =>
      c.json(await a.triage.accept(c.req.param("itemId"), c.req.valid("json"))),
    )
    .post("/triage/:itemId/decline", jsonBody(TriageDecisionRequest), (c) =>
      c.json(a.triage.decline(c.req.param("itemId"), c.req.valid("json"))),
    )
    .get("/:id", (c) => c.json(itemOf(s, a.definitions.get(c.req.param("id")))))
    .patch("/:id", jsonBody(UpdateAutomationRequest), (c) => {
      const updated = a.definitions.update(c.req.param("id"), c.req.valid("json"));
      a.refresh();
      return c.json(itemOf(s, updated));
    })
    .delete("/:id", (c) => {
      a.definitions.remove(c.req.param("id"));
      a.refresh();
      return c.json({ ok: true as const });
    })
    .post("/:id/enable", jsonBody(SetAutomationEnabledRequest), (c) => {
      const { projectId } = c.req.valid("json");
      const updated = a.definitions.setEnabled(c.req.param("id"), true, projectId);
      a.refresh();
      return c.json(itemOf(s, updated, projectId));
    })
    .post("/:id/disable", jsonBody(SetAutomationEnabledRequest), (c) => {
      const { projectId } = c.req.valid("json");
      const updated = a.definitions.setEnabled(c.req.param("id"), false, projectId);
      a.refresh();
      return c.json(itemOf(s, updated, projectId));
    })
    .post("/:id/run", jsonBody(RunAutomationRequest), async (c) =>
      c.json(await a.run(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/:id/pause", jsonBody(AutomationProjectRequest), async (c) => {
      const { projectId } = c.req.valid("json");
      await a.pause(c.req.param("id"), projectId);
      return c.json(itemOf(s, a.definitions.get(c.req.param("id")), projectId));
    })
    .post("/:id/resume", jsonBody(AutomationProjectRequest), async (c) => {
      const { projectId } = c.req.valid("json");
      await a.resume(c.req.param("id"), projectId);
      return c.json(itemOf(s, a.definitions.get(c.req.param("id")), projectId));
    })
    .post("/:id/skip-next", jsonBody(AutomationProjectRequest), async (c) => {
      const { projectId } = c.req.valid("json");
      return c.json({ skipped: await a.skipNextRun(c.req.param("id"), projectId) });
    });
}

/** `/api/projects/:id/automations/...`: the starter set and the project's automation switch. */
export function projectAutomationRoutes(s: AppServices) {
  const a = s.automations;
  return new Hono()
    .post("/:projectId/automations/starter", jsonBody(StarterSetRequest), (c) => {
      const body: StarterSetResponse = {
        automations: a.definitions.starterSet(c.req.param("projectId"), c.req.valid("json").enable),
      };
      a.refresh();
      return c.json(body);
    })
    .get("/:projectId/automations/settings", (c) => {
      const projectId = c.req.param("projectId");
      s.projects.get(projectId);
      return c.json<AutomationProjectSettings>(a.schedules.projectSettings(projectId));
    })
    .patch(
      "/:projectId/automations/settings",
      jsonBody(UpdateAutomationProjectSettingsRequest),
      (c) => {
        const projectId = c.req.param("projectId");
        s.projects.get(projectId);
        const body = a.schedules.setProjectEnabled(projectId, c.req.valid("json").enabled);
        a.refresh();
        return c.json<AutomationProjectSettings>(body);
      },
    );
}
