import type { CodeDenClient } from "./client";
import { type Fetcher, isNotAvailable } from "./http";
import type { BrowserChannel, BrowserFrame, LoadedContext, PrDetails } from "./types";

type UnwiredApi = Pick<
  CodeDenClient,
  | "getPrDetails"
  | "getLoadedContext"
  | "listSlashCommands"
  | "openBrowser"
  | "listMemoryFiles"
  | "readConfigFile"
  | "writeConfigFile"
  | "listSkills"
  | "setSkillEnabled"
  | "listSubagents"
  | "listMcpServers"
  | "testMcpServer"
>;

/** Resolve to `fallback` when the server does not have the route yet. */
async function orFallback<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isNotAvailable(error)) return fallback;
    throw error;
  }
}

/**
 * Parts of the real client whose server APIs are being built separately (browser panel,
 * agent configuration, PR details, loaded context, slash commands). They call the planned
 * routes and degrade to empty results when a route does not exist yet.
 */
export function configApi(http: Fetcher, wsBase: string): UnwiredApi {
  const { get, post, call } = http;
  const enc = encodeURIComponent;
  const q = (v: string | null) => (v ? `?projectId=${enc(v)}` : "");
  const noPr: PrDetails = { issue: null, pr: null };
  const noContext: LoadedContext = { memory: [], skills: [], mcpServers: [] };

  return {
    getPrDetails: (id) => orFallback(get<PrDetails>(`/sessions/${enc(id)}/github`), noPr),
    getLoadedContext: (id) =>
      orFallback(get<LoadedContext>(`/sessions/${enc(id)}/context`), noContext),
    listSlashCommands: (id) => orFallback(get(`/sessions/${enc(id)}/commands`), []),
    openBrowser: (sessionId) => browserSocket(`${wsBase}/ws/browser?sessionId=${enc(sessionId)}`),

    listMemoryFiles: (projectId) => orFallback(get(`/agent-config/memory${q(projectId)}`), []),
    readConfigFile: (path) =>
      get<{ contents: string }>(`/agent-config/file?path=${enc(path)}`).then((r) => r.contents),
    async writeConfigFile(path, contents) {
      await call("PUT", "/agent-config/file", { path, contents });
    },
    listSkills: (projectId) => orFallback(get(`/agent-config/skills${q(projectId)}`), []),
    async setSkillEnabled(id, enabled) {
      await call("PATCH", `/agent-config/skills/${enc(id)}`, { enabled });
    },
    listSubagents: (projectId) => orFallback(get(`/agent-config/subagents${q(projectId)}`), []),
    listMcpServers: (projectId) => orFallback(get(`/agent-config/mcp${q(projectId)}`), []),
    testMcpServer: (id) => post(`/agent-config/mcp/${enc(id)}/test`),
  };
}

/** Browser screencast channel; reports `unavailable` when the socket can't be opened. */
function browserSocket(url: string): BrowserChannel {
  const ws = new WebSocket(url);
  const frames = new Set<(f: BrowserFrame) => void>();
  const unavailable = new Set<() => void>();
  let gotFrame = false;
  ws.onmessage = (e) => {
    try {
      const frame = JSON.parse(String(e.data)) as BrowserFrame;
      gotFrame = true;
      for (const l of frames) l(frame);
    } catch {
      // Ignore malformed frames.
    }
  };
  ws.onclose = (e) => {
    if (!gotFrame && e.code !== 1000) for (const l of unavailable) l();
  };
  const send = (msg: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  return {
    onFrame: (l) => {
      frames.add(l);
      return () => frames.delete(l);
    },
    onUnavailable: (l) => {
      unavailable.add(l);
      return () => unavailable.delete(l);
    },
    navigate: (target) => send({ type: "navigate", url: target }),
    back: () => send({ type: "back" }),
    forward: () => send({ type: "forward" }),
    reload: () => send({ type: "reload" }),
    setControl: (owner) => send({ type: "control", owner }),
    click: (x, y) => send({ type: "click", x, y }),
    close: () => ws.close(1000),
  };
}
