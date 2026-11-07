import { UsageQuery, UsageSettings } from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/**
 * `/api/usage` (§12.6): report for a range, CSV export, per-session and per-project spend,
 * rate-limit windows, budgets and the editable price table.
 */
export function usageRoutes(s: AppServices) {
  return new Hono()
    .get("/report", queryOf(UsageQuery), async (c) =>
      c.json(await s.usage.report(c.req.valid("query"))),
    )
    .get("/export.csv", queryOf(UsageQuery), (c) => {
      const q = c.req.valid("query");
      return c.body(s.usage.csv(q), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="codeden-usage-${q.from}-to-${q.to}.csv"`,
      });
    })
    .get("/sessions/:id", async (c) => c.json(await s.usage.sessionUsage(c.req.param("id"))))
    .get("/projects/:id", async (c) => c.json(await s.usage.projectSpend(c.req.param("id"))))
    .get("/limits", async (c) => c.json(await s.usage.limits()))
    .get("/budgets", (c) => c.json(s.usage.budgets()))
    .get("/settings", (c) => c.json(s.usage.settingsResponse()))
    .put("/settings", jsonBody(UsageSettings), (c) =>
      c.json(s.usage.saveSettings(c.req.valid("json"))),
    );
}
