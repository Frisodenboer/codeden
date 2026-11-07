import {
  type FactoryItemResponse,
  FactoryTriageRequest,
  KillSwitchRequest,
  PutVisionRequest,
  SetAutonomyModeRequest,
} from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { jsonBody } from "./validate";

/**
 * `/api/projects/:id/...`: autonomy mode, vision, the factory panel and its controls (§10.1).
 * Mounted under `/projects`.
 */
export function projectFactoryRoutes(s: AppServices) {
  const f = s.factory;
  return new Hono()
    .get("/:id/factory", (c) => c.json(f.status(c.req.param("id"))))
    .put("/:id/autonomy", jsonBody(SetAutonomyModeRequest), (c) =>
      c.json(f.setMode(c.req.param("id"), c.req.valid("json"))),
    )
    .get("/:id/vision", (c) => c.json(f.vision(c.req.param("id"))))
    .put("/:id/vision", jsonBody(PutVisionRequest), async (c) =>
      c.json(await f.putVision(c.req.param("id"), c.req.valid("json").contents)),
    )
    .post("/:id/kill-switch", jsonBody(KillSwitchRequest), async (c) =>
      c.json(await f.setKillSwitch(c.req.param("id"), c.req.valid("json").on)),
    )
    .post("/:id/factory/resume", (c) => c.json(f.resume(c.req.param("id"))))
    .post("/:id/factory/tick", async (c) => {
      await f.tick(c.req.param("id"));
      return c.json(f.status(c.req.param("id")));
    })
    .post("/:id/factory/digest", async (c) => c.json(await f.digestNow(c.req.param("id"))))
    .get("/:id/factory/items/:itemId", (c) =>
      c.json<FactoryItemResponse>({ item: f.item(c.req.param("id"), c.req.param("itemId")) }),
    )
    .post("/:id/factory/triage", jsonBody(FactoryTriageRequest), async (c) =>
      c.json<FactoryItemResponse>({ item: await f.triage(c.req.param("id"), c.req.valid("json")) }),
    );
}

/** `/api/factory`: the global kill switch. */
export function factoryRoutes(s: AppServices) {
  return new Hono().post("/kill-switch", jsonBody(KillSwitchRequest), async (c) =>
    c.json(await s.factory.setGlobalKillSwitch(c.req.valid("json").on)),
  );
}
