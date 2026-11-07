import {
  type InboxItem,
  type Project,
  ServerToClientMessage,
  SessionSnapshot,
  Settings,
  Snapshot,
  type StartWorkResult,
} from "@codeden/contracts";
import type { CodeDenClient } from "./client";
import type {
  BrowserChannel,
  ConflictCase,
  DiffResult,
  DirListing,
  FactoryStatus,
  FileContent,
  FileNode,
  LoadedContext,
  McpServerEntry,
  MemoryFile,
  MentionCandidate,
  PrDetails,
  SetupStatus,
  SkillEntry,
  SlashCommand,
  SubagentEntry,
  TerminalChannel,
} from "./types";

/**
 * Real client: fetch + WebSocket against the CodeDen server. Paths follow the planned HTTP API;
 * the integration step swaps these for the typed Hono RPC client once `api.ts` lands in
 * contracts. Auth rides on the HttpOnly cookie set by the launch URL (§15).
 */
export function createHttpClient(origin: string): CodeDenClient {
  const base = `${origin}/api`;

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    parse?: (v: unknown) => T,
  ): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} failed (${res.status})`);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    return parse ? parse(json) : (json as T);
  }
  const get = <T>(path: string, parse?: (v: unknown) => T) =>
    call<T>("GET", path, undefined, parse);
  const post = <T = void>(path: string, body?: unknown) => call<T>("POST", path, body ?? {});
  const q = (v: string | null) => (v ? `?projectId=${encodeURIComponent(v)}` : "");

  function socketChannel(path: string): WebSocket {
    return new WebSocket(`${origin.replace(/^http/, "ws")}${path}`);
  }

  return {
    kind: "http",
    getSnapshot: () => get("/snapshot", (v) => Snapshot.parse(v)),
    getSessionSnapshot: (id) => get(`/sessions/${id}/snapshot`, (v) => SessionSnapshot.parse(v)),
    subscribe(fromSeq, onMessage) {
      let ws: WebSocket | undefined;
      let stopped = false;
      let delay = 500;
      let lastSeq = fromSeq;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const open = () => {
        ws = socketChannel("/ws");
        ws.onopen = () => {
          delay = 500;
          ws?.send(JSON.stringify({ type: "subscribe", fromSeq: lastSeq }));
        };
        ws.onmessage = (event) => {
          const parsed = ServerToClientMessage.safeParse(JSON.parse(String(event.data)));
          if (!parsed.success) return;
          const msg = parsed.data;
          if (msg.type === "events") lastSeq = msg.events.at(-1)?.seq ?? lastSeq;
          if (msg.type === "resync") lastSeq = msg.seq;
          onMessage(msg);
        };
        ws.onclose = () => {
          if (stopped) return;
          timer = setTimeout(open, delay);
          delay = Math.min(delay * 2, 10_000);
        };
      };
      open();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        ws?.close();
      };
    },

    sendMessage: (id, input, mode) => post(`/sessions/${id}/messages`, { input, mode }),
    interrupt: (id) => post(`/sessions/${id}/interrupt`),
    respond: (id, requestId, response) => post(`/sessions/${id}/requests/${requestId}`, response),
    startSession: (input) => post<StartWorkResult>("/sessions", input),
    stopSession: (id) => post(`/sessions/${id}/stop`),
    listConflicts: () => get<ConflictCase[]>("/conflicts"),
    resolveConflict: (id, decision) => post(`/conflicts/${id}/resolve`, decision),
    resolveInbox: (id, resolution) => post<InboxItem>(`/inbox/${id}/resolve`, resolution),

    createProject: (input) => post<Project>("/projects", input),
    setAutomationEnabled: (id, enabled) => call("PATCH", `/automations/${id}`, { enabled }),
    skipNextRun: (id) => post(`/automations/${id}/skip-next`),
    getFactoryStatus: (id) => get<FactoryStatus>(`/projects/${id}/factory`),
    setKillSwitch: (scope, on) =>
      scope === "global"
        ? post("/factory/kill-switch", { on })
        : post(`/projects/${scope.projectId}/kill-switch`, { on }),
    readVision: (id) => get<{ contents: string }>(`/projects/${id}/vision`).then((r) => r.contents),
    writeVision: (id, contents) => call("PUT", `/projects/${id}/vision`, { contents }),

    updateSettings: (patch) => call("PATCH", "/settings", patch, (v) => Settings.parse(v)),
    setSecret: (name, value) => call("PUT", `/secrets/${name}`, { value }),

    getSetupStatus: () => get<SetupStatus>("/setup"),
    recheckSetup: (id) => post<SetupStatus>("/setup/recheck", { id }),
    completeSetup: () => post("/setup/complete"),
    listDirectory: (path) =>
      get<DirListing>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),

    getDiff: (id, scope) => post<DiffResult>(`/sessions/${id}/diff`, scope),
    listFiles: (id) => get<FileNode[]>(`/sessions/${id}/files`),
    readFile: (id, path) =>
      get<FileContent>(`/sessions/${id}/files/content?path=${encodeURIComponent(path)}`),
    getPrDetails: (id) => get<PrDetails>(`/sessions/${id}/github`),
    getLoadedContext: (id) => get<LoadedContext>(`/sessions/${id}/context`),
    searchMentions: (id, query) =>
      get<MentionCandidate[]>(`/sessions/${id}/mentions?q=${encodeURIComponent(query)}`),
    listSlashCommands: (id) => get<SlashCommand[]>(`/sessions/${id}/commands`),
    openTerminal(opts): TerminalChannel {
      const params = new URLSearchParams();
      if (opts.sessionId) params.set("sessionId", opts.sessionId);
      if (opts.command) params.set("command", opts.command);
      const ws = socketChannel(`/ws/pty?${params}`);
      const listeners = new Set<(d: string) => void>();
      ws.onmessage = (e) => {
        for (const l of listeners) l(String(e.data));
      };
      const send = (msg: unknown) =>
        ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
      return {
        write: (data) => send({ type: "input", data }),
        resize: (cols, rows) => send({ type: "resize", cols, rows }),
        onData: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        close: () => ws.close(),
      };
    },
    openBrowser(sessionId): BrowserChannel {
      const ws = socketChannel(`/ws/browser?sessionId=${encodeURIComponent(sessionId)}`);
      const listeners = new Set<Parameters<BrowserChannel["onFrame"]>[0]>();
      ws.onmessage = (e) => {
        const frame = JSON.parse(String(e.data));
        for (const l of listeners) l(frame);
      };
      const send = (msg: unknown) =>
        ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
      return {
        onFrame: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        navigate: (url) => send({ type: "navigate", url }),
        back: () => send({ type: "back" }),
        forward: () => send({ type: "forward" }),
        reload: () => send({ type: "reload" }),
        setControl: (owner) => send({ type: "control", owner }),
        click: (x, y) => send({ type: "click", x, y }),
        close: () => ws.close(),
      };
    },
    artifactUrl: (id) => `${base}/artifacts/${encodeURIComponent(id)}`,

    listMemoryFiles: (projectId) => get<MemoryFile[]>(`/agent-config/memory${q(projectId)}`),
    readConfigFile: (path) =>
      get<{ contents: string }>(`/agent-config/file?path=${encodeURIComponent(path)}`).then(
        (r) => r.contents,
      ),
    writeConfigFile: (path, contents) => call("PUT", "/agent-config/file", { path, contents }),
    listSkills: (projectId) => get<SkillEntry[]>(`/agent-config/skills${q(projectId)}`),
    setSkillEnabled: (id, enabled) => call("PATCH", `/agent-config/skills/${id}`, { enabled }),
    listSubagents: (projectId) => get<SubagentEntry[]>(`/agent-config/subagents${q(projectId)}`),
    listMcpServers: (projectId) => get<McpServerEntry[]>(`/agent-config/mcp${q(projectId)}`),
    testMcpServer: (id) => post<{ ok: boolean; message: string }>(`/agent-config/mcp/${id}/test`),
  };
}
