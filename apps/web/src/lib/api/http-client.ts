import {
  type ConflictDecision,
  CreateProjectResponse,
  DiffResult,
  FsListResponse,
  GitCommitResponse,
  GitPushResponse,
  GitStatusResponse,
  InboxItem,
  LoginCommandResponse,
  RestoreFilesResponse,
  type SendMessageRequestInit,
  SessionDetail,
  SessionFileContent,
  SessionFileList,
  SessionSnapshot,
  Settings,
  SetupStatus,
  Snapshot,
  SpeechSummaryResponse,
  StartSessionResponse,
} from "@codeden/contracts";
import type { CodeDenClient, SendMode } from "./client";
import { createFetcher } from "./http";
import { configApi } from "./http-unwired";
import { RealtimeSocket } from "./realtime-socket";
import { openTerminalSocket } from "./terminal-channel";
import type { ConflictCase, MentionCandidate } from "./types";

const whenBusy: Record<SendMode, SendMessageRequestInit["whenBusy"]> = {
  send: "queue",
  queue: "queue",
  steer: "steer",
};

export interface HttpClientOptions {
  /** Called when the server answers 401 (missing or expired cookie). */
  onUnauthorized?: () => void;
}

/**
 * Real client: fetch + WebSocket against the CodeDen server's `/api`, `/ws` and `/ws/pty`.
 * Request and response shapes come from `@codeden/contracts`; responses are validated.
 */
export function createHttpClient(origin: string, opts: HttpClientOptions = {}): CodeDenClient {
  const http = createFetcher(origin, opts.onUnauthorized ?? (() => {}));
  const { get, post, call } = http;
  const wsBase = origin.replace(/^http/, "ws");
  const socket = new RealtimeSocket(`${wsBase}/ws`);
  const enc = encodeURIComponent;
  const conflicts = new Map<string, ConflictCase>();
  const fileCache = new Map<string, { at: number; list: SessionFileList }>();

  return {
    kind: "http",
    getSnapshot: () => get("/snapshot", (v) => Snapshot.parse(v)),
    getSessionSnapshot: (id) =>
      get(`/sessions/${enc(id)}/snapshot`, (v) => SessionSnapshot.parse(v)),
    subscribe: (fromSeq, onMessage) => socket.subscribe(fromSeq, onMessage),
    watchSession: (id, fromSeq, onMessage) => socket.watch(id, fromSeq, onMessage),
    onConnectionChange: (listener) => socket.onState(listener),

    getSessionDetail: (id) => get(`/sessions/${enc(id)}`, (v) => SessionDetail.parse(v)),
    async sendMessage(id, input, mode) {
      const body: SendMessageRequestInit = { input, whenBusy: whenBusy[mode] };
      await post(`/sessions/${enc(id)}/messages`, body);
    },
    async interrupt(id) {
      await post(`/sessions/${enc(id)}/interrupt`);
    },
    async respond(id, requestId, response) {
      await post(`/sessions/${enc(id)}/respond`, { requestId, response });
    },
    async startSession(input) {
      const res = await fetchStart(origin, input);
      if (res.status === "conflict") {
        const id = `conflict-${Date.now()}`;
        conflicts.set(id, {
          id,
          projectId: input.projectId,
          request: {
            purpose: input.purpose ?? input.input?.text.split("\n")[0] ?? "New session",
            workKey: input.workKey ?? "",
            requestedBy: "You",
          },
          existing: res.existing,
          createdAt: new Date().toISOString(),
          start: input,
        });
      }
      return res;
    },
    async stopSession(id) {
      await post(`/sessions/${enc(id)}/stop`);
    },

    listConflicts: async () => [...conflicts.values()],
    async resolveConflict(conflict: ConflictCase, decision: ConflictDecision) {
      conflicts.delete(conflict.id);
      if (!conflict.start) return;
      await post("/sessions", { ...conflict.start, conflict: decision }, (v) =>
        StartSessionResponse.parse(v),
      );
    },
    resolveInbox: (id, resolution) =>
      post(`/inbox/${enc(id)}/resolve`, resolution, (v) => InboxItem.parse(v)),

    createProject: (input) => post("/projects", input, (v) => CreateProjectResponse.parse(v)),
    async setAutomationEnabled(id, enabled) {
      await call("PATCH", `/automations/${enc(id)}`, { enabled });
    },
    async skipNextRun(id) {
      await post(`/automations/${enc(id)}/skip-next`);
    },
    getFactoryStatus: (id) => get(`/projects/${enc(id)}/factory`),
    async setKillSwitch(scope, on) {
      if (scope === "global") await post("/factory/kill-switch", { on });
      else await post(`/projects/${enc(scope.projectId)}/kill-switch`, { on });
    },
    readVision: (id) =>
      get<{ contents: string }>(`/projects/${enc(id)}/vision`).then((r) => r.contents),
    async writeVision(id, contents) {
      await call("PUT", `/projects/${enc(id)}/vision`, { contents });
    },

    updateSettings: (patch) => call("PATCH", "/settings", patch, (v) => Settings.parse(v)),
    async setSecret(name, value) {
      await call("PUT", `/secrets/${enc(name)}`, { value });
    },

    getSetupStatus: (o) =>
      get(`/setup/status${o?.refresh ? "?refresh=1" : ""}`, (v) => SetupStatus.parse(v)),
    loginCommand: (tool) => post(`/setup/login/${tool}`, {}, (v) => LoginCommandResponse.parse(v)),
    async completeSetup() {
      await post("/setup/complete");
    },
    listDirectory(path, o) {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      if (o?.showHidden) params.set("showHidden", "1");
      const qs = params.size ? `?${params}` : "";
      return get(`/fs/list${qs}`, (v) => FsListResponse.parse(v));
    },

    getDiff: (id, scope) => post(`/sessions/${enc(id)}/diff`, scope, (v) => DiffResult.parse(v)),
    restoreFiles: (id, req) =>
      post(`/sessions/${enc(id)}/restore`, req, (v) => RestoreFilesResponse.parse(v)),
    gitStatus: (id) => get(`/sessions/${enc(id)}/git/status`, (v) => GitStatusResponse.parse(v)),
    gitCommit: (id, req) =>
      post(`/sessions/${enc(id)}/git/commit`, req, (v) => GitCommitResponse.parse(v)),
    gitPush: (id, req) =>
      post(`/sessions/${enc(id)}/git/push`, req, (v) => GitPushResponse.parse(v)),
    listFiles: (id) => get(`/sessions/${enc(id)}/files`, (v) => SessionFileList.parse(v)),
    readFile: (id, path) =>
      get(`/sessions/${enc(id)}/files/content?path=${enc(path)}`, (v) =>
        SessionFileContent.parse(v),
      ),
    async searchMentions(id, query) {
      const cached = fileCache.get(id);
      const list =
        cached && Date.now() - cached.at < 30_000
          ? cached.list
          : await get(`/sessions/${enc(id)}/files`, (v) => SessionFileList.parse(v));
      fileCache.set(id, { at: cached?.list === list ? cached.at : Date.now(), list });
      return rankMentions(list, query);
    },
    openTerminal: (o) => openTerminalSocket(wsBase, o),
    artifactUrl: (id) => `${origin}/api/artifacts/${enc(id)}`,
    speechSummary: (text) =>
      post("/utility/speech-summary", { text }, (v) => SpeechSummaryResponse.parse(v)),

    ...configApi(http, wsBase),
  };
}

/** `@` mention candidates: paths containing the query, shortest first. */
export function rankMentions(list: SessionFileList, query: string): MentionCandidate[] {
  const q = query.toLowerCase();
  return list.entries
    .filter((e) => e.path.toLowerCase().includes(q))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, 8)
    .map((e) => ({ path: e.path, kind: e.kind }));
}

/** `POST /api/sessions` answers 409 for a conflict; that body is a result, not an error. */
async function fetchStart(origin: string, input: unknown): Promise<StartSessionResponse> {
  const res = await fetch(`${origin}/api/sessions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const json: unknown = await res.json().catch(() => null);
  const parsed = StartSessionResponse.safeParse(json);
  if (parsed.success) return parsed.data;
  const message =
    (json as { error?: { message?: string } } | null)?.error?.message ??
    `Couldn't start the session (${res.status})`;
  throw new Error(message);
}
