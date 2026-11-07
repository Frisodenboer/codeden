import {
  type Automation,
  AutomationAction,
  AutomationGuards,
  type AutomationListItem,
  type AutomationRun,
  type AutomationState,
  type AutomationTemplate,
  type ScheduledRun,
} from "@codeden/contracts";
import type { AutomationsApi } from "../automations-api";
import { uid } from "./live";
import type { MockWorld } from "./world";

const delay = <T>(value: T, ms = 90): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));

const template = (
  id: string,
  name: string,
  description: string,
  trigger: AutomationTemplate["trigger"],
  starter: boolean,
): AutomationTemplate => ({
  id,
  name,
  description,
  source: "builtin",
  path: null,
  trigger,
  action:
    id === "issue-triage"
      ? { type: "triage" }
      : { type: "start_session", prompt: `Run the ${name.toLowerCase()} of {{project.name}}.` },
  guards: AutomationGuards.parse({ maxPerDay: 1 }),
  workKey: `automation:${id}`,
  starter,
  requiresGithub: id === "issue-triage" || id === "stale-pr-follow-up",
});

const TEMPLATES: AutomationTemplate[] = [
  template(
    "security-audit",
    "Security audit",
    "Weekly vulnerability review.",
    cron("0 3 * * 1"),
    true,
  ),
  template(
    "dependency-updates",
    "Dependency updates",
    "Patch and minor bumps.",
    cron("0 6 * * 1"),
    true,
  ),
  template(
    "test-coverage",
    "Test coverage gaps",
    "Add tests where they matter.",
    cron("0 4 * * 3"),
    true,
  ),
  template("refactor-sweep", "Refactor sweep", "Small, safe cleanups.", cron("0 3 * * 6"), false),
  template(
    "ui-review",
    "UI review",
    "Screenshots and accessibility.",
    { type: "event", event: "pr.opened" },
    false,
  ),
  template(
    "issue-triage",
    "Issue triage",
    "Classify new issues.",
    { type: "event", event: "issue.opened" },
    true,
  ),
  template("stale-pr-follow-up", "Stale PR follow-up", "Nudge idle PRs.", cron("0 10 * * *"), true),
];

function cron(expression: string): AutomationTemplate["trigger"] {
  return { type: "cron", expression };
}

/** In-memory automations API over the mock world (scheduled runs, runs history, switches). */
export function mockAutomationsApi(world: MockWorld): AutomationsApi {
  const paused = new Set<string>();
  const projectOff = new Set<string>();
  const runs: AutomationRun[] = [];
  const key = (a: string, p: string) => `${a}|${p}`;
  const projectOf = (a: Automation) =>
    a.target.type === "project" ? a.target.projectId : (world.snapshot.projects[0]?.id ?? "");
  const find = (id: string) => {
    const a = world.snapshot.automations.find((x) => x.id === id);
    if (!a) throw new Error(`No automation ${id}`);
    return a;
  };
  const state = (a: Automation, projectId: string): AutomationState => {
    const enabled =
      world.snapshot.settings.automations.enabled && !projectOff.has(projectId) && a.enabled;
    const next = world.snapshot.scheduled.find((r) => r.automationId === a.id);
    const live = enabled && !paused.has(key(a.id, projectId));
    return {
      projectId,
      enabled,
      enabledOverride: null,
      paused: paused.has(key(a.id, projectId)),
      nextRunAt: live ? (next?.at ?? null) : null,
      skipNextAt: live && next?.skipped ? next.at : null,
    };
  };
  const item = (a: Automation): AutomationListItem => ({
    automation: a,
    states: [state(a, projectOf(a))],
    lastRun: runs.find((r) => r.automationId === a.id) ?? null,
    path: null,
    readOnly: false,
  });
  const save = (a: Automation) => {
    world.emitDomain({ type: "automation.saved", sessionId: null, payload: { automation: a } });
    return item(a);
  };
  const touched = (automationId: string | null, projectId: string) =>
    world.emitDomain({
      type: "automation.updated",
      sessionId: null,
      payload: { automationId, projectId },
    });
  const fromTemplate = (templateId: string, projectId: string, enabled: boolean): Automation => {
    const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
    const now = new Date().toISOString();
    return {
      id: uid("a"),
      name: t?.name ?? "Automation",
      description: t?.description ?? null,
      enabled,
      source: "database",
      templateId: t?.id ?? null,
      trigger: t?.trigger ?? { type: "manual" },
      action: t?.action ?? { type: "message_pm", message: "Check in" },
      target: { type: "project", projectId },
      guards: t?.guards ?? AutomationGuards.parse({}),
      workKey: t?.workKey,
      createdAt: now,
      updatedAt: now,
    };
  };

  return {
    list: (projectId) =>
      delay({
        automations: world.snapshot.automations
          .filter((a) => !projectId || projectOf(a) === projectId)
          .map(item),
        errors: [],
      }),
    get: (id) => delay(item(find(id))),
    async create(req) {
      const base = fromTemplate(req.templateId ?? "security-audit", req.projectId ?? "", false);
      return save({
        ...base,
        ...(req.name ? { name: req.name } : {}),
        ...(req.trigger ? { trigger: req.trigger } : {}),
        ...(req.action ? { action: AutomationAction.parse(req.action) } : {}),
        enabled: req.enabled ?? false,
      });
    },
    async update(id, req) {
      const a = find(id);
      return save({
        ...a,
        ...(req.name ? { name: req.name } : {}),
        ...(req.description !== undefined ? { description: req.description } : {}),
        ...(req.trigger ? { trigger: req.trigger } : {}),
        ...(req.action ? { action: req.action } : {}),
        guards: AutomationGuards.parse({ ...a.guards, ...req.guards }),
        updatedAt: new Date().toISOString(),
      });
    },
    async remove(id) {
      world.emitDomain({
        type: "automation.deleted",
        sessionId: null,
        payload: { automationId: id },
      });
    },
    setEnabled: async (id, enabled) => save({ ...find(id), enabled }),
    async run(id, req) {
      const a = find(id);
      const run: AutomationRun = {
        id: uid("r"),
        automationId: id,
        projectId: req.projectId,
        status: "running",
        triggeredBy: "manual",
        startedBy: { kind: "automation", id },
        purpose: a.name,
        workKey: a.workKey ?? `automation:${id}`,
        scope: { projectId: req.projectId },
        progress: null,
        skipReason: null,
        sessionId: world.snapshot.sessions.find((s) => s.projectId === req.projectId)?.id ?? null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
      runs.unshift(run);
      world.emitDomain({ type: "automation_run.updated", sessionId: null, payload: { run } });
      return { status: "started", run, sessionId: run.sessionId };
    },
    async pause(id, projectId) {
      paused.add(key(id, projectId));
      touched(id, projectId);
      return item(find(id));
    },
    async resume(id, projectId) {
      paused.delete(key(id, projectId));
      touched(id, projectId);
      return item(find(id));
    },
    async skipNext(id, projectId) {
      let skipped: ScheduledRun | null = null;
      world.snapshot.scheduled = world.snapshot.scheduled.map((r) => {
        if (r.automationId !== id || r.skipped) return r;
        skipped = { ...r, skipped: true };
        return skipped;
      });
      touched(id, projectId);
      return skipped;
    },
    runs: (q = {}) =>
      delay(
        runs.filter(
          (r) =>
            (!q.projectId || r.projectId === q.projectId) &&
            (!q.automationId || r.automationId === q.automationId),
        ),
      ),
    async cancelRun(runId) {
      const run = runs.find((r) => r.id === runId);
      if (!run) throw new Error(`No run ${runId}`);
      Object.assign(run, { status: "cancelled", finishedAt: new Date().toISOString() });
      return structuredClone(run);
    },
    upcoming: (projectId) =>
      delay(world.snapshot.scheduled.filter((r) => !projectId || r.projectId === projectId)),
    templates: () => delay(TEMPLATES),
    reload: () => delay({ automations: world.snapshot.automations.map(item), errors: [] }),
    async starterSet(projectId, enable) {
      const automations = TEMPLATES.filter((t) => t.starter).map((t) => {
        const a = fromTemplate(t.id, projectId, enable);
        world.emitDomain({ type: "automation.saved", sessionId: null, payload: { automation: a } });
        return a;
      });
      return { automations };
    },
    projectSettings: (projectId) =>
      delay({ projectId, enabled: !projectOff.has(projectId), updatedAt: null }),
    async setProjectEnabled(projectId, enabled) {
      if (enabled) projectOff.delete(projectId);
      else projectOff.add(projectId);
      touched(null, projectId);
      return { projectId, enabled, updatedAt: new Date().toISOString() };
    },
    async acceptTriage(itemId) {
      const found = world.snapshot.inbox.find((i) => i.id === itemId);
      if (!found) throw new Error(`No inbox item ${itemId}`);
      const closed = {
        ...found,
        status: "resolved" as const,
        resolvedAt: new Date().toISOString(),
      };
      world.emitDomain({ type: "inbox.updated", sessionId: null, payload: { item: closed } });
      return { item: closed, start: null };
    },
    async declineTriage(itemId) {
      const found = world.snapshot.inbox.find((i) => i.id === itemId);
      if (!found) throw new Error(`No inbox item ${itemId}`);
      const closed = {
        ...found,
        status: "dismissed" as const,
        resolvedAt: new Date().toISOString(),
      };
      world.emitDomain({ type: "inbox.updated", sessionId: null, payload: { item: closed } });
      return { item: closed, start: null };
    },
  };
}
