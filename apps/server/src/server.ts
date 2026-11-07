import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
  BrowserWsQuery,
  CODEDEN_VERSION,
  type RunnerConnectionStatus,
  type ServerLock,
  TerminalQuery,
} from "@codeden/contracts";
import { ImageEngineRegistry } from "@codeden/providers";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { type Database, openDatabase } from "./db/client";
import { EventStore } from "./events/store";
import { writeJsonFile } from "./json-file";
import { createMcpHandler } from "./mcp/endpoint";
import { ensureHome, type HomePaths } from "./paths";
import { BrowserBridge } from "./realtime/browser";
import { WsHub } from "./realtime/hub";
import { TerminalBridge } from "./realtime/terminals";
import { createApi } from "./routes/api";
import { findWebDir, mountWeb } from "./routes/static";
import { RunnerClient } from "./runner/client";
import { defaultRunnerLaunch, type RunnerLaunchConfig } from "./runner/launcher";
import { loopbackOrigins, securityMiddleware } from "./security";
import { type AppServices, createServices, type ServicesOptions } from "./services/container";
import type { Exec } from "./services/exec";
import { runnerPort } from "./services/runner-port";
import { createSecretStore, MemorySecretStore, type SecretStore } from "./services/secrets";
import type { UtilityService } from "./services/utility";
import { SettingsStore } from "./settings-store";

export interface StartServerOptions {
  /** Port to listen on (127.0.0.1 only). 0 picks a free port. */
  port: number;
  /** Data directory (`~/.codeden` by default; resolve it with `resolveHome`). */
  dataDir: string;
  /** Per-install token required on every request (§15). */
  token: string;
  /**
   * How to start the runner. `undefined` = auto-detect (bundle or monorepo source),
   * `false` = don't use a runner (tests, UI-only work).
   */
  runner?: RunnerLaunchConfig | false;
  /** Load the scripted Fake provider in the runner (development and tests). */
  enableFakeProvider?: boolean;
  /**
   * Load the real Claude Code and Codex adapters in a runner this server starts. Default true,
   * unless `CODEDEN_BUILTIN_PROVIDERS=0` (the server test suite sets it).
   */
  builtinProviders?: boolean;
  /** Built web assets to serve; auto-detected when omitted. */
  webDir?: string;
  /** Extra allowed origins, e.g. the Vite dev server. */
  allowedOrigins?: string[];
  /** Drizzle migrations folder; auto-detected when omitted. */
  migrationsDir?: string;
  /** Wait for the runner handshake before resolving. Default false. */
  waitForRunner?: boolean;
  /** Called when a client requests shutdown via the API (the CLI exits the process). */
  onShutdownRequest?: () => void;
  /** Secret storage: the OS keychain by default; `"memory"` for tests. */
  secrets?: SecretStore | "memory";
  /** Utility-model jobs (§7.4); one-shots through the runner's providers by default. */
  utility?: UtilityService;
  /** Runs CLI tools (detection, git); injectable for tests. */
  exec?: Exec;
  /** User home for provider config files and the default clone folder. */
  userHome?: string;
  /** Where clones go by default (`~/codeden-projects`). */
  projectsDir?: string;
  /** How long `ask_user` waits for an answer before returning "pending" (default 4 min). */
  askUserWaitMs?: number;
  /** Batching window for live UI updates (default 40ms). */
  realtimeFlushMs?: number;
  /**
   * Image engines for `generate_image` (§12.5). Default: Codex, Gemini and OpenAI, or none
   * when built-in providers are off (`CODEDEN_BUILTIN_PROVIDERS=0`, the server test suite).
   */
  imageEngines?: ImageEngineRegistry;
  /** Cloud voice API base URLs (tests). */
  voice?: { elevenLabsBaseUrl?: string; openAiBaseUrl?: string };
  /** Orchestration seams and timings (§8): GitHub/automation ports, wake debounce, ask_pm wait. */
  orchestration?: ServicesOptions["orchestration"];
  /**
   * GitHub (§9): API transport and poll intervals for tests, and `sync: false` to skip
   * background polling (default on unless `CODEDEN_GITHUB_SYNC=0`).
   */
  github?: ServicesOptions["github"] & { sync?: boolean };
  /** Automations (§10): clock, scheduler timings and file rescans for tests. */
  automations?: ServicesOptions["automations"];
  /** Run first-run detection in the background on launch (default true). */
  checkSetupOnStart?: boolean;
  log?: (message: string) => void;
}

export interface RunningServer {
  port: number;
  /** Base URL, e.g. `http://127.0.0.1:4317`. */
  url: string;
  /** URL that authenticates the browser on first load. */
  launchUrl: string;
  paths: HomePaths;
  store: EventStore;
  database: Database;
  services: AppServices;
  runner: RunnerClient | undefined;
  /** Stop listening and disconnect from the runner (which keeps running). */
  close(opts?: { stopRunner?: boolean }): Promise<void>;
}

/**
 * Start the CodeDen server (§4.1). This is the only entry point; it imports nothing
 * platform-specific so a desktop shell can host it later (§17).
 */
export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => {});
  const paths = ensureHome(opts.dataDir);
  const database = openDatabase(paths.db, opts.migrationsDir);
  const store = new EventStore(database.db);
  const settings = new SettingsStore(paths.settings);
  const startedAt = Date.now();
  let port = opts.port;
  let runner: RunnerClient | undefined;
  let closing: Promise<void> | undefined;

  const disabledStatus: RunnerConnectionStatus = {
    state: "disabled",
    runnerId: null,
    version: null,
    providers: [],
    lastError: null,
  };
  const runnerStatus = () => runner?.status ?? disabledStatus;
  const hub = new WsHub(store, database.db, runnerStatus, { flushMs: opts.realtimeFlushMs });
  const secrets =
    opts.secrets === "memory"
      ? new MemorySecretStore()
      : (opts.secrets ?? (await createSecretStore(log)));
  const builtin = opts.builtinProviders ?? process.env.CODEDEN_BUILTIN_PROVIDERS !== "0";
  const services = createServices({
    db: database.db,
    store,
    settings,
    paths,
    runner: runnerPort(() => runner),
    secrets,
    exec: opts.exec,
    utility: opts.utility,
    userHome: opts.userHome,
    projectsDir: opts.projectsDir,
    askUserWaitMs: opts.askUserWaitMs,
    imageEngines: opts.imageEngines ?? (builtin ? undefined : new ImageEngineRegistry([])),
    voice: opts.voice,
    orchestration: opts.orchestration,
    github: opts.github,
    automations: opts.automations,
    log,
  });
  // Find out early whether `generate_image` can be offered to agents.
  void services.images.refresh();
  services.lifecycle.start();
  services.orchestration.start();
  services.github.start({ sync: opts.github?.sync ?? process.env.CODEDEN_GITHUB_SYNC !== "0" });
  services.usage.start();
  services.automations.start();

  let origins = new Set<string>();
  const app = new Hono();
  app.use(
    "*",
    securityMiddleware({
      token: opts.token,
      cookieName: () => `codeden_token_${port}`,
      allowedOrigins: () => origins,
      // `/mcp` authenticates agents with per-session tokens instead of the install token.
      publicPaths: new Set(["/api/health", "/mcp"]),
    }),
  );
  const api = createApi({
    services,
    runnerStatus,
    startedAt,
    log,
    shutdown: ({ stopRunner }) => {
      setTimeout(() => {
        void close({ stopRunner }).then(() => opts.onShutdownRequest?.());
      }, 50);
    },
  });
  app.route("/api", api);
  const mcp = createMcpHandler({ tokens: services.mcpTokens, registry: services.tools, log });
  app.all("/mcp", (c) => mcp(c.req.raw));
  app.get(
    "/ws",
    upgradeWebSocket(() => hub.handlers()),
  );
  const terminals = new TerminalBridge({
    runner: services.runner,
    cwdFor: (sessionId) => {
      const session = sessionId ? services.sessionRepo.find(sessionId)?.session : undefined;
      return session ? (session.worktreePath ?? session.cwd) : paths.home;
    },
    log,
  });
  const stopTerminalEvents = store.subscribe((events) => terminals.onEvents(events));
  app.get("/ws/pty", async (c, next) => {
    const query = TerminalQuery.safeParse(c.req.query());
    if (!query.success)
      return c.json({ error: { code: "bad_request", message: "Invalid terminal query" } }, 400);
    return upgradeWebSocket(() => terminals.handlers(query.data))(c, next);
  });
  const browserBridge = new BrowserBridge({ browser: services.browser, log });
  app.get("/ws/browser", async (c, next) => {
    const query = BrowserWsQuery.safeParse(c.req.query());
    if (!query.success)
      return c.json({ error: { code: "bad_request", message: "Invalid browser query" } }, 400);
    if (!services.sessionRepo.find(query.data.sessionId))
      return c.json({ error: { code: "session_not_found", message: "No such session" } }, 404);
    return upgradeWebSocket(() => browserBridge.handlers(query.data))(c, next);
  });
  mountWeb(app, findWebDir(opts.webDir));

  const wss = new WebSocketServer({ noServer: true });
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve(
      { fetch: app.fetch, port: opts.port, hostname: "127.0.0.1", websocket: { server: wss } },
      () => resolve(s),
    );
    s.once("error", reject);
  });
  port = (server.address() as AddressInfo).port;
  origins = new Set([...loopbackOrigins(port), ...(opts.allowedOrigins ?? [])]);
  const url = `http://127.0.0.1:${port}`;
  const lock: ServerLock = {
    pid: process.pid,
    port,
    version: CODEDEN_VERSION,
    startedAt: new Date(startedAt).toISOString(),
  };
  writeJsonFile(paths.serverLock, lock);
  log(`server listening on ${url}`);

  if (opts.checkSetupOnStart !== false) {
    // Re-check tools silently on every launch (§14 step 6); results are cached.
    services.setup
      .status({ refresh: true })
      .catch((error: unknown) => log(`setup: ${String(error)}`));
  }

  if (opts.runner !== false) {
    const args = [
      ...(opts.enableFakeProvider ? ["--fake"] : []),
      ...(builtin ? [] : ["--no-builtin"]),
    ];
    const launch = opts.runner ?? defaultRunnerLaunch(args) ?? null;
    runner = new RunnerClient({
      home: paths.home,
      lockFile: paths.runnerLock,
      db: database.db,
      store,
      launch,
      mcpUpstreamUrl: `${url}/mcp`,
      onStatus: (status) => hub.broadcastRunner(status),
      onStream: (stream) => {
        if (stream.kind === "pty.output") terminals.onStream(stream);
        else browserBridge.onStream(stream);
      },
      onReady: () => void services.recovery.onRunnerReady(),
      log,
    });
    const started = runner.start();
    if (opts.waitForRunner) await started;
    else started.catch((error: unknown) => log(`runner: ${String(error)}`));
  }

  async function close(closeOpts: { stopRunner?: boolean } = {}): Promise<void> {
    closing ??= (async () => {
      services.lifecycle.stop();
      services.orchestration.stop();
      services.github.stop();
      services.usage.stop();
      services.automations.stop();
      stopTerminalEvents();
      if (runner) {
        if (closeOpts.stopRunner) await runner.shutdownRunner();
        else await runner.stop();
      }
      hub.close();
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ("closeAllConnections" in server) server.closeAllConnections();
      });
      database.close();
      rmSync(paths.serverLock, { force: true });
    })();
    return closing;
  }

  return {
    port,
    url,
    launchUrl: `${url}/?token=${opts.token}`,
    paths,
    store,
    database,
    services,
    runner,
    close,
  };
}

/** Type of the HTTP API for the Hono RPC client (`hc<AppType>(baseUrl + "/api")`). */
export type AppType = ReturnType<typeof createApi>;
