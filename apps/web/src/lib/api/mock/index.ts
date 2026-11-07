import { type Project, Settings, type SettingsPatch } from "@codeden/contracts";
import type { CodeDenClient } from "../client";
import { startAmbient } from "./ambient";
import { makeSession } from "./fixtures/helpers";
import { defaultFactoryLimits, factoryFor, visionDoc } from "./fixtures/ops";
import { type Script, scriptedTurn, uid } from "./live";
import { respond } from "./responses";
import { workbenchApi } from "./workbench-api";
import { MockWorld } from "./world";

const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));

function deepMerge<T>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out as T;
}

export interface MockClientOptions {
  /** Start background activity (streaming sessions). Off in tests. */
  ambient?: boolean;
}

/** Fully featured in-memory client with rich fixtures and scripted live events. */
export function createMockClient(opts: MockClientOptions = {}): CodeDenClient {
  const world = new MockWorld();
  const running = new Map<string, Script>();
  const queued = new Map<string, string[]>();
  if (opts.ambient) startAmbient(world);

  const runTurn = (sessionId: string, text: string) => {
    const script = scriptedTurn(world, sessionId, { text }, () => {
      running.delete(sessionId);
      const next = queued.get(sessionId)?.shift();
      if (next) runTurn(sessionId, next);
    });
    running.set(sessionId, script.start());
  };

  const createSession = (projectId: string, prompt: string, workKey: string) => {
    const id = uid("s");
    const project = world.snapshot.projects.find((p) => p.id === projectId);
    const session = makeSession({
      id,
      projectId,
      role: "agent",
      status: "starting",
      provider: "claude",
      model: "opus",
      purpose: prompt.split(/[.\n]/)[0]?.slice(0, 60) ?? "New session",
      workKey,
      branch: `codeden/${id.slice(2, 10)}`,
      baseBranch: "main",
      worktreePath: `~/.codeden/wt/${project?.slug ?? "project"}/${id.slice(2, 10)}`,
      createdAt: new Date().toISOString(),
    });
    world.emitDomain({ type: "session.created", sessionId: null, payload: { session } });
    runTurn(id, prompt);
    return id;
  };

  return {
    kind: "mock",
    getSnapshot: () => delay(world.snapshot, 150),
    getSessionSnapshot: (id) => delay(world.sessionSnapshot(id), 120),
    subscribe: (fromSeq, onMessage) => world.subscribe(fromSeq, onMessage),

    async sendMessage(sessionId, input, mode) {
      const active = running.get(sessionId);
      if (active && mode === "queue") {
        queued.set(sessionId, [...(queued.get(sessionId) ?? []), input.text]);
        return;
      }
      if (active && mode === "steer") {
        const t = world.transcript(sessionId);
        const turnId = t.threads[t.rootThreadId ?? ""]?.turnIds.at(-1);
        if (turnId && t.rootThreadId)
          world.emitAgent(sessionId, {
            type: "item.completed",
            threadId: t.rootThreadId,
            turnId,
            item: {
              id: uid("u"),
              kind: "user_message",
              status: "completed",
              input: { text: input.text, attachments: input.attachments ?? [] },
            },
          });
        return;
      }
      runTurn(sessionId, input.text);
    },
    async interrupt(sessionId) {
      running.get(sessionId)?.cancel();
      running.delete(sessionId);
      const t = world.transcript(sessionId);
      const thread = t.threads[t.rootThreadId ?? ""];
      const turnId = thread?.turnIds.at(-1);
      if (thread && turnId && t.turns[turnId]?.status === "running") {
        world.emitAgent(sessionId, {
          type: "turn.interrupted",
          threadId: thread.id,
          turnId,
          reason: "user",
        });
      }
      world.updateSession(sessionId, { status: "idle" });
    },
    async respond(sessionId, requestId, response) {
      const script = respond(world, sessionId, requestId, response);
      if (script) running.set(sessionId, script.start());
    },
    async startSession(input) {
      const workKey = input.workKey ?? `request:${uid("w")}`;
      const clash = world.snapshot.sessions.find(
        (s) =>
          s.projectId === input.projectId &&
          s.workKey === workKey &&
          ["running", "waiting", "starting", "queued"].includes(s.status),
      );
      if (clash) {
        return {
          status: "conflict",
          existing: [
            {
              kind: "session",
              id: clash.id,
              sessionId: clash.id,
              projectId: clash.projectId,
              startedBy: clash.startedBy,
              purpose: clash.purpose,
              workKey: clash.workKey,
              scope: clash.scope,
              progress: clash.progress,
              status: clash.status,
              startedAt: clash.createdAt,
            },
          ],
        };
      }
      return {
        status: "started",
        sessionId: createSession(input.projectId, input.prompt, workKey),
      };
    },
    async stopSession(sessionId) {
      running.get(sessionId)?.cancel();
      world.updateSession(sessionId, { status: "stopped", endedAt: new Date().toISOString() });
    },

    listConflicts: () => delay(world.conflicts),
    async resolveConflict(conflictId, decision) {
      const conflict = world.conflicts.find((c) => c.id === conflictId);
      world.conflicts = world.conflicts.filter((c) => c.id !== conflictId);
      if (!conflict) return;
      if (decision.resolution === "join") runTurn(decision.sessionId, conflict.request.purpose);
      if (decision.resolution === "force" && conflict.projectId)
        createSession(conflict.projectId, conflict.request.purpose, conflict.request.workKey);
    },

    async resolveInbox(itemId, resolution) {
      const item = world.snapshot.inbox.find((i) => i.id === itemId);
      if (!item) throw new Error("Inbox item not found");
      const now = new Date().toISOString();
      const next = {
        ...item,
        status: "resolved" as const,
        resolvedAt: now,
        updatedAt: now,
        resolution,
      };
      world.emitDomain({ type: "inbox.updated", sessionId: null, payload: { item: next } });
      return next;
    },

    async createProject(input) {
      const path =
        input.source === "folder"
          ? input.path
          : `C:\\Users\\leon\\Code\\${input.url
              .split("/")
              .at(-1)
              ?.replace(/\.git$/, "")}`;
      const name =
        (input.source === "folder" ? input.name : undefined) ??
        path.split("\\").at(-1) ??
        "project";
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .slice(0, 40) || "project";
      const now = new Date().toISOString();
      const project: Project = {
        id: uid("p"),
        kind: "local",
        name,
        slug,
        path,
        defaultBranch: "main",
        defaultProvider: null,
        autonomy: null,
        autonomyMode: "assisted",
        visionPath: ".codeden/VISION.md",
        factoryLimits: defaultFactoryLimits,
        killSwitch: false,
        timezone: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      world.emitDomain({ type: "project.created", sessionId: null, payload: { project } });
      return delay(project, 400);
    },
    async setAutomationEnabled(id, enabled) {
      const a = world.snapshot.automations.find((x) => x.id === id);
      if (a)
        world.emitDomain({
          type: "automation.saved",
          sessionId: null,
          payload: { automation: { ...a, enabled } },
        });
    },
    async skipNextRun(automationId) {
      world.snapshot.scheduled = world.snapshot.scheduled.map((r) =>
        r.automationId === automationId ? { ...r, skipped: !r.skipped } : r,
      );
    },
    getFactoryStatus(projectId) {
      const project = world.snapshot.projects.find((p) => p.id === projectId);
      const cached = world.factory.get(projectId);
      const status =
        cached ??
        factoryFor(
          projectId,
          project?.autonomyMode ?? "assisted",
          project?.factoryLimits ?? defaultFactoryLimits,
        );
      world.factory.set(projectId, status);
      return delay(status, 140);
    },
    async setKillSwitch(scope, on) {
      if (scope === "global") {
        const settings = deepMerge(world.snapshot.settings, { factory: { killSwitch: on } });
        world.emitDomain({ type: "settings.updated", sessionId: null, payload: { settings } });
        return;
      }
      const f = world.factory.get(scope.projectId);
      if (f)
        world.factory.set(scope.projectId, {
          ...f,
          killSwitch: on,
          loopState: on ? "stopped" : "building",
        });
      const project = world.snapshot.projects.find((p) => p.id === scope.projectId);
      if (project)
        world.emitDomain({
          type: "project.updated",
          sessionId: null,
          payload: { project: { ...project, killSwitch: on } },
        });
    },
    readVision: (projectId) => delay(world.files.get(`vision:${projectId}`) ?? visionDoc),
    async writeVision(projectId, contents) {
      world.files.set(`vision:${projectId}`, contents);
    },

    async updateSettings(patch: SettingsPatch) {
      const settings = Settings.parse(deepMerge(world.snapshot.settings, patch));
      world.emitDomain({ type: "settings.updated", sessionId: null, payload: { settings } });
      return settings;
    },
    setSecret: () => delay(undefined, 300),

    ...workbenchApi(world),
  };
}
