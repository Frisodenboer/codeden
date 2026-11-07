import { UpdateInstallRequest } from "@codeden/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../services/container";
import { badRequest } from "../services/errors";
import { isVersionName } from "../services/updates/app-dir";
import { jsonBody, queryOf } from "./validate";

/** `/api/updates`: the update check, one-click install and restart, rollback, notes (§16). */
export function updateRoutes(s: AppServices) {
  return new Hono()
    .get("/", queryOf(z.object({ refresh: z.enum(["1", "true"]).optional() })), async (c) =>
      c.json(await s.updates.status({ refresh: c.req.valid("query").refresh !== undefined })),
    )
    .post("/install", jsonBody(UpdateInstallRequest), (c) =>
      c.json(s.updates.install(c.req.valid("json"))),
    )
    .post("/restart", (c) => c.json(s.updates.restartNow()))
    .post("/rollback", (c) => c.json(s.updates.rollback()))
    .get("/notes", queryOf(z.object({ version: z.string().min(1) })), async (c) => {
      const { version } = c.req.valid("query");
      if (!isVersionName(version)) throw badRequest(`"${version}" is not a version`);
      return c.json(await s.updates.notes(version));
    });
}
