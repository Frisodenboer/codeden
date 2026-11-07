import { ListInboxQuery, ResolveInboxRequest } from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/** `/api/inbox`: list, counts, resolve in place (§11.1). */
export function inboxRoutes(s: AppServices) {
  return new Hono()
    .get("/", queryOf(ListInboxQuery), (c) => c.json(s.inbox.list(c.req.valid("query"))))
    .get("/counts", (c) => c.json(s.inbox.counts()))
    .get("/:id", (c) => c.json(s.inbox.get(c.req.param("id"))))
    .post("/:id/resolve", jsonBody(ResolveInboxRequest), async (c) =>
      c.json(await s.inbox.resolve(c.req.param("id"), c.req.valid("json"))),
    );
}
