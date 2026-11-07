/**
 * Live orchestration test (real Claude orchestrator and PM, small cost). Run with
 *   CODEDEN_LIVE=1 pnpm --filter @codeden/server exec vitest run test/live/orchestration.live.test.ts
 * An agent session with work key `automation:security-audit` is already running (Fake
 * provider). The user asks the orchestrator for a security audit; the orchestrator must
 * consult the PM (`ask_pm`), and the answer must mention the running audit without starting
 * a duplicate.
 */
import {
  type ItemRecord,
  RoleMessageResponse,
  StartSessionResponse,
  ThreadItemsPage,
} from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness, waitUntil } from "../support/harness";

const LIVE = process.env.CODEDEN_LIVE === "1";
const MODEL = process.env.CODEDEN_LIVE_ORCHESTRATION_MODEL ?? "sonnet";

describe.skipIf(!LIVE)("live orchestration", () => {
  let h: Harness;

  const items = async (sessionId: string): Promise<ItemRecord[]> => {
    const d = await h.detail(sessionId);
    if (!d.session.rootThreadId) return [];
    const res = await h.api(
      "GET",
      `/sessions/${sessionId}/threads/${d.session.rootThreadId}/items?limit=500`,
    );
    return ThreadItemsPage.parse(res.body).items;
  };
  const dump = (label: string, records: ItemRecord[]) => {
    for (const { item } of records) {
      const detail =
        item.kind === "tool_call"
          ? `${item.toolName} ${JSON.stringify(item.input ?? {}).slice(0, 200)} -> ${(item.output?.text ?? item.error?.message ?? "").slice(0, 400)}`
          : item.kind === "assistant_message"
            ? item.text.slice(0, 1200)
            : item.kind === "user_message"
              ? item.input.text.slice(-300)
              : "";
      console.log(`[live] ${label} ${item.kind} ${item.status} ${detail}`);
    }
  };

  beforeAll(async () => {
    h = await startHarness({
      builtinProviders: true,
      orchestration: { askTimeoutMs: 280_000 },
      log: (m) => console.log(`[server] ${m}`),
    });
    const settings = await h.api("PATCH", "/settings", {
      providers: {
        orchestrator: { provider: "claude", model: MODEL, effort: "low" },
        pm: { provider: "claude", model: MODEL, effort: "low" },
      },
    });
    expect(settings.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it("orchestrator consults the PM and does not duplicate a running audit", async () => {
    const audit = StartSessionResponse.parse(
      (
        await h.api("POST", "/sessions", {
          projectId: h.projectId,
          provider: "fake",
          workKey: "automation:security-audit",
          purpose: "Weekly security audit",
          title: "Weekly security audit",
          startedBy: { kind: "automation", id: "security-audit" },
          input: { text: "audit [approval]" },
        })
      ).body,
    );
    if (audit.status !== "started") throw new Error("audit did not start");
    await waitUntil(async () =>
      (await h.detail(audit.sessionId)).session.status === "waiting" ? true : undefined,
    );
    // The Fake turn is parked; present it as a running audit with progress.
    h.server.services.sessionRepo.update(audit.sessionId, (s) => ({
      ...s,
      status: "running",
      progress: {
        text: "Scanning dependencies for known CVEs (3 of 5 packages)",
        at: new Date().toISOString(),
      },
    }));

    const project = h.server.services.projects.get(h.projectId);
    const t0 = Date.now();
    const sent = RoleMessageResponse.parse(
      (
        await h.api("POST", "/orchestration/orchestrator/messages", {
          input: { text: `Run a security audit on ${project.name}` },
        })
      ).body,
    );
    const orchestratorId = sent.sessionId;

    await waitUntil(async () => {
      const d = await h.detail(orchestratorId);
      if (d.session.status === "failed") throw new Error("orchestrator failed");
      const done =
        d.session.status === "idle" &&
        (await items(orchestratorId)).some((r) => r.item.kind === "assistant_message");
      return done ? true : undefined;
    }, 480_000);
    console.log(`[live] orchestrator turn finished in ${Math.round((Date.now() - t0) / 1000)}s`);

    const orch = await items(orchestratorId);
    dump("orchestrator", orch);
    const pm = h.server.services.orchestration.roles.find("pm", h.projectId);
    expect(pm).toBeTruthy();
    if (pm) dump("pm", await items(pm.id));

    // 1. The orchestrator consulted the PM.
    const askCalls = orch.filter(
      (r) => r.item.kind === "tool_call" && /ask_pm/.test(r.item.toolName),
    );
    expect(askCalls.length).toBeGreaterThanOrEqual(1);
    // 2. Its reply mentions the audit that is already running.
    const finals = orch.filter((r) => r.item.kind === "assistant_message");
    const reply = finals
      .map((r) => (r.item.kind === "assistant_message" ? r.item.text : ""))
      .join("\n");
    expect(reply).toMatch(/audit/i);
    expect(reply).toMatch(/already|running|in progress|underway/i);
    // 3. No duplicate audit was started.
    const audits = h.server.services.sessionRepo.list({
      projectId: h.projectId,
      role: "agent",
      workKey: "automation:security-audit",
    });
    expect(audits.map((s) => s.id)).toEqual([audit.sessionId]);
    expect(
      h.server.services.sessionRepo.list({ projectId: h.projectId, role: "agent" }),
    ).toHaveLength(1);
  }, 600_000);
});
