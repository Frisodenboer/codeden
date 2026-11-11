import { CancelWakeupQuery, type ScheduledWakeup } from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { notFound } from "../services/errors";
import { collectProjectPlans } from "../services/scheduled/project-plans";
import { queryOf } from "./validate";

/** `/api/scheduled`: upcoming automation runs and pending wake-ups across every project. */
export function scheduledRoutes(s: AppServices) {
  return new Hono()
    .get("/", (c) => {
      const reminders = s.orchestration.reminders;
      const owners: { target: "orchestrator" | "pm"; projectId: string | null }[] = [
        { target: "orchestrator", projectId: null },
        ...s.projects.list({ includeArchived: false }).map((p) => ({
          target: "pm" as const,
          projectId: p.id,
        })),
      ];
      const wakeups: ScheduledWakeup[] = owners.flatMap((o) =>
        reminders.pending(o.target, o.projectId).flatMap((n) =>
          n.type === "reminder" && n.notBefore
            ? [
                {
                  id: n.id,
                  target: o.target,
                  projectId: o.projectId,
                  at: n.notBefore,
                  note: n.data.note,
                },
              ]
            : [],
        ),
      );
      wakeups.sort((a, b) => a.at.localeCompare(b.at));
      const projects = s.projects.list({ includeArchived: false });
      const planned = collectProjectPlans(
        projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
      );
      return c.json({ runs: s.automations.listScheduledRuns(null, 100), wakeups, planned });
    })
    .delete("/wakeups/:id", queryOf(CancelWakeupQuery), (c) => {
      const q = c.req.valid("query");
      const ok = s.orchestration.reminders.cancel(q.target, q.projectId ?? null, c.req.param("id"));
      if (!ok) throw notFound("That wake-up is no longer pending", "wakeup_not_found");
      return c.json({ ok: true });
    });
}
