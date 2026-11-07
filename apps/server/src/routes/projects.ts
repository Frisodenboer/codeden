import { CreateProjectRequest, UpdateProjectRequest } from "@codeden/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/** `/api/projects`: add from a folder or clone, list, update, archive. */
export function projectRoutes(s: AppServices) {
  return new Hono()
    .get("/", queryOf(z.object({ archived: z.enum(["true", "false"]).optional() })), (c) =>
      c.json(s.projects.list({ includeArchived: c.req.valid("query").archived === "true" })),
    )
    .post("/", jsonBody(CreateProjectRequest), async (c) =>
      c.json(await s.projects.create(c.req.valid("json")), 201),
    )
    .get("/:id", (c) => c.json(s.projects.get(c.req.param("id"))))
    .patch("/:id", jsonBody(UpdateProjectRequest), (c) =>
      c.json(s.projects.update(c.req.param("id"), c.req.valid("json"))),
    )
    .delete("/:id", (c) => {
      s.projects.archive(c.req.param("id"));
      return c.json({ ok: true as const });
    });
}
