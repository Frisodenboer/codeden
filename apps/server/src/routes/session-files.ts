import { SessionFileQuery } from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { listSessionFiles, readSessionFile } from "../services/files/session-files";
import { workdir } from "../services/workbench/workbench-service";
import { queryOf } from "./validate";

/** `/api/sessions/:id/files`: read-only file tree and viewer for the session's worktree (§12.3). */
export function sessionFileRoutes(s: AppServices) {
  return new Hono()
    .get("/:id/files", (c) =>
      c.json(listSessionFiles(workdir(s.sessionRepo.get(c.req.param("id"))))),
    )
    .get("/:id/files/content", queryOf(SessionFileQuery), (c) =>
      c.json(
        readSessionFile(workdir(s.sessionRepo.get(c.req.param("id"))), c.req.valid("query").path),
      ),
    );
}
