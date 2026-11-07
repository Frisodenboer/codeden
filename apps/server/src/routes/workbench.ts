import {
  DiffScope,
  GitCommitRequest,
  GitPushRequest,
  RestoreFilesRequest,
  SpeechSummaryRequest,
} from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { jsonBody } from "./validate";

/**
 * Per-session workbench routes under `/api/sessions/:id` (§9, §12.3): checkpoints, turn and
 * session diffs, file restore, and git status/commit/push for the session's worktree.
 */
export function workbenchRoutes(s: AppServices) {
  return new Hono()
    .get("/:id/checkpoints", (c) =>
      c.json({ checkpoints: s.workbench.checkpoints(c.req.param("id")) }),
    )
    .post("/:id/diff", jsonBody(DiffScope), async (c) =>
      c.json(await s.workbench.diff(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/:id/restore", jsonBody(RestoreFilesRequest), async (c) =>
      c.json(await s.workbench.restore(c.req.param("id"), c.req.valid("json"))),
    )
    .get("/:id/git/status", async (c) => c.json(await s.workbench.status(c.req.param("id"))))
    .post("/:id/git/commit", jsonBody(GitCommitRequest), async (c) =>
      c.json(await s.workbench.commit(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/:id/git/push", jsonBody(GitPushRequest), async (c) =>
      c.json(await s.workbench.push(c.req.param("id"), c.req.valid("json"))),
    );
}

/** `/api/utility`: utility-model jobs the UI asks for (§7.4). */
export function utilityRoutes(s: AppServices) {
  return new Hono().post("/speech-summary", jsonBody(SpeechSummaryRequest), async (c) =>
    c.json(await s.utility.speechSummary(c.req.valid("json").text)),
  );
}
