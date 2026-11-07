/**
 * Live automation test (real Claude, small cost). Run with
 *   CODEDEN_LIVE=1 pnpm --filter @codeden/server exec vitest run test/live/automations.live.test.ts
 * The built-in security-audit template is enabled on a temporary project with a cron that
 * fires every 20 seconds, in auto mode. The first fire must start a real Claude session that
 * reports progress; the next fire, while that session still runs, must be skipped (overlap)
 * with an `automation.skipped` notice for the PM. The automation is then disabled and the
 * session stopped to keep the cost down.
 */
import { type AutomationListItem, AutomationRun, AutomationTemplate } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness, waitUntil } from "../support/harness";

const LIVE = process.env.CODEDEN_LIVE === "1";
const MODEL = process.env.CODEDEN_LIVE_AUTOMATION_MODEL ?? "sonnet";

describe.skipIf(!LIVE)("live automations", () => {
  let h: Harness;
  let automationId = "";

  const runs = async () =>
    AutomationRun.array().parse(
      (await h.api("GET", `/automations/runs?automationId=${automationId}`)).body,
    );

  beforeAll(async () => {
    h = await startHarness(
      {
        builtinProviders: true,
        github: { sync: false },
        log: (m) => {
          if (m.includes("automation")) console.log(`[server] ${m}`);
        },
      },
      {
        "src/server.js": [
          'const http = require("http");',
          'const { exec } = require("child_process");',
          "http.createServer((req, res) => {",
          '  const q = new URL(req.url, "http://x").searchParams.get("q");',
          '  exec("grep " + q + " data.txt", (e, out) => res.end(out));',
          "}).listen(3000);",
        ].join("\n"),
      },
    );
  }, 60_000);

  afterAll(async () => {
    if (automationId) await h?.api("POST", `/automations/${automationId}/disable`, {});
    await h?.close();
  });

  it("runs the security audit on schedule and skips the overlapping fire", async () => {
    const templates = AutomationTemplate.array().parse(
      (await h.api("GET", "/automations/templates")).body,
    );
    const audit = templates.find((t) => t.id === "security-audit");
    if (audit?.action.type !== "start_session") throw new Error("no security-audit template");
    const created = await h.api("POST", "/automations", {
      templateId: "security-audit",
      projectId: h.projectId,
      trigger: { type: "cron", expression: "*/20 * * * * *", timezone: "UTC" },
      action: {
        ...audit.action,
        provider: "claude",
        model: MODEL,
        effort: "low",
        autonomy: "auto",
      },
      guards: { maxPerDay: null },
      enabled: true,
    });
    expect(created.status).toBe(201);
    automationId = (created.body as AutomationListItem).automation.id;

    const first = await waitUntil(async () => (await runs()).find((r) => r.sessionId), 60_000);
    console.log(`[live] first run ${first.id} ${first.status} session ${first.sessionId}`);
    expect(first).toMatchObject({ triggeredBy: "cron", workKey: "automation:security-audit" });
    const sessionId = first.sessionId ?? "";

    const skipped = await waitUntil(
      async () => (await runs()).find((r) => r.status === "skipped"),
      60_000,
    );
    console.log(`[live] skipped run ${skipped.id} ${skipped.skipReason}`);
    expect(skipped.skipReason).toBe("overlap");
    await h.api("POST", `/automations/${automationId}/disable`, {});
    const notice = await waitUntil(() =>
      h.server.services.orchestration.notices
        .list({ projectId: h.projectId })
        .find((n) => n.type === "automation.skipped"),
    );
    expect(notice.data).toMatchObject({ reason: "overlap", automationId });

    const detail = await h.detail(sessionId);
    expect(detail.session).toMatchObject({
      provider: "claude",
      autonomy: "auto",
      startedBy: { kind: "automation", id: automationId },
      automationRunId: first.id,
    });
    // The agent is really working: it reports progress (step 1 of the template).
    const progressed = await waitUntil(async () => {
      const d = await h.detail(sessionId);
      return d.session.progress ?? (d.session.status === "idle" ? d.session.result : undefined);
    }, 240_000);
    console.log(`[live] agent: ${JSON.stringify(progressed).slice(0, 300)}`);

    await h.api("POST", `/sessions/${sessionId}/stop`);
    const final = await waitUntil(async () => {
      const run = (await runs()).find((r) => r.id === first.id);
      return run && run.status !== "running" ? run : undefined;
    }, 60_000);
    console.log(`[live] first run ended ${final.status}`);
    expect(["cancelled", "completed"]).toContain(final.status);
  }, 480_000);
});
