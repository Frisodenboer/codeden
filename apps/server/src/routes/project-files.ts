import { ProjectFileOp, SessionFileQuery } from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { applyProjectFileOp } from "../services/files/project-files";
import { listSessionFiles, readSessionFile } from "../services/files/session-files";
import { jsonBody, queryOf } from "./validate";

/** `/api/projects/:id/files`: the project file manager on the project's main checkout. */
export function projectFileRoutes(s: AppServices) {
  const root = (id: string) => s.projects.get(id).path;
  return new Hono()
    .get("/:id/files", (c) => c.json(listSessionFiles(root(c.req.param("id")))))
    .get("/:id/files/content", queryOf(SessionFileQuery), (c) =>
      c.json(readSessionFile(root(c.req.param("id")), c.req.valid("query").path)),
    )
    .post("/:id/files/ops", jsonBody(ProjectFileOp), (c) =>
      c.json(applyProjectFileOp(root(c.req.param("id")), c.req.valid("json"))),
    );
}
