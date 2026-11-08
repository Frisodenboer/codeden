import {
  ArchiveSessionRequest,
  ListSessionsQuery,
  RespondRequest,
  SendMessageRequest,
  StartSessionRequest,
  SteerRequest,
  ThreadItemsQuery,
  type ToolOutputResponse,
  UpdateSessionRequest,
} from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { badRequest, notFound } from "../services/errors";
import { previewRecord } from "../services/sessions/preview";
import { jsonBody, queryOf } from "./validate";

/**
 * `/api/sessions`: start (with conflict handling), message, steer, interrupt, respond, stop,
 * archive (removes the worktree, §9) and unarchive.
 */
export function sessionRoutes(s: AppServices) {
  return new Hono()
    .get("/", queryOf(ListSessionsQuery), (c) => c.json(s.sessionRepo.list(c.req.valid("query"))))
    .post("/", jsonBody(StartSessionRequest), async (c) => {
      const req = c.req.valid("json");
      const result = await s.sessions.start(req);
      if (result.status !== "conflict") return c.json(result, 200);
      // Persist the conflict (inbox item) so it can be resolved later (§8.4).
      const record = s.orchestration.conflicts.record(req, result.existing);
      return c.json({ ...result, conflictId: record.id }, 409);
    })
    .get("/:id", (c) => c.json(s.sessions.detail(c.req.param("id"))))
    .patch("/:id", jsonBody(UpdateSessionRequest), (c) =>
      c.json(s.sessions.update(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/:id/messages", jsonBody(SendMessageRequest), async (c) =>
      c.json(await s.sessions.send(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/:id/steer", jsonBody(SteerRequest), async (c) => {
      await s.sessions.steer(c.req.param("id"), c.req.valid("json").input);
      return c.json({ ok: true as const });
    })
    .post("/:id/interrupt", async (c) => {
      await s.sessions.interrupt(c.req.param("id"));
      return c.json({ ok: true as const });
    })
    .post("/:id/respond", jsonBody(RespondRequest), async (c) => {
      await s.sessions.respond(c.req.param("id"), c.req.valid("json"));
      return c.json({ ok: true as const });
    })
    .post("/:id/stop", async (c) => c.json(await s.sessions.stop(c.req.param("id"))))
    .post("/:id/archive", jsonBody(ArchiveSessionRequest), async (c) =>
      c.json(await s.worktreeCleanup.archive(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/:id/unarchive", (c) => c.json(s.worktreeCleanup.unarchive(c.req.param("id"))))
    .get("/:id/threads/:threadId/items", queryOf(ThreadItemsQuery), (c) => {
      const id = c.req.param("id");
      s.sessionRepo.get(id);
      const page = s.sessionRepo.threadPage(id, c.req.param("threadId"), c.req.valid("query"));
      return c.json({ ...page, items: page.items.map((r) => previewRecord(r)) });
    })
    .get("/:id/items/:itemId/output", (c) => {
      const record = s.sessionRepo.item(c.req.param("id"), c.req.param("itemId"));
      if (!record) throw notFound("No such item", "item_not_found");
      const { item } = record;
      if (item.kind !== "tool_call") throw badRequest("Only tool calls have output", "no_output");
      const text = item.output?.text ?? "";
      const body: ToolOutputResponse = {
        itemId: item.id,
        text,
        totalBytes: Buffer.byteLength(text, "utf8"),
      };
      return c.json(body);
    });
}
