import { CancelWakeupQuery, type DoneItem, type ScheduledWakeup } from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { notFound } from "../services/errors";
import { collectProjectDone, collectProjectPlans } from "../services/scheduled/project-plans";
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
      const folders = projects.map((p) => ({ id: p.id, name: p.name, path: p.path }));
      const planned = collectProjectPlans(folders);
      // Finished scheduled automation runs of the last 30 days, plus finished project plans.
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const automationName = new Map(
        s.automations
          .list(undefined)
          .automations.map((a) => [a.automation.id, a.automation.name] as const),
      );
      const runsDone: DoneItem[] = s.automations.runs
        .list({ limit: 200 })
        .filter(
          (r) =>
            (r.status === "completed" || r.status === "failed") &&
            r.triggeredBy !== "manual" &&
            r.finishedAt !== null &&
            Date.parse(r.finishedAt) >= since,
        )
        .map((r) => ({
          id: `run:${r.id}`,
          projectId: r.projectId,
          at: r.finishedAt ?? r.startedAt,
          source: "run" as const,
          title: automationName.get(r.automationId) ?? "Automation run",
          ok: r.status === "completed",
        }));
      const done = [...runsDone, ...collectProjectDone(folders)].sort((a, b) =>
        b.at.localeCompare(a.at),
      );
      return c.json({
        runs: s.automations.listScheduledRuns(null, 100),
        wakeups,
        planned,
        done,
      });
    })
    .delete("/wakeups/:id", queryOf(CancelWakeupQuery), (c) => {
      const q = c.req.valid("query");
      const ok = s.orchestration.reminders.cancel(q.target, q.projectId ?? null, c.req.param("id"));
      if (!ok) throw notFound("That wake-up is no longer pending", "wakeup_not_found");
      return c.json({ ok: true });
    });
}
