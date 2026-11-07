import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { CODEDEN_VERSION, type RunnerConnectionStatus, type ServerLock } from "@codeden/contracts";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { type Database, openDatabase } from "./db/client";
import { EventStore } from "./events/store";
import { writeJsonFile } from "./json-file";
import { ensureHome, type HomePaths } from "./paths";
import { createApi } from "./routes/api";
import { findWebDir, mountWeb } from "./routes/static";
import { WsHub } from "./routes/ws-hub";
import { RunnerClient } from "./runner/client";
import { defaultRunnerLaunch, type RunnerLaunchConfig } from "./runner/launcher";
import { loopbackOrigins, securityMiddleware } from "./security";
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
  const hub = new WsHub(store, runnerStatus);

  let origins = new Set<string>();
  const app = new Hono();
  app.use(
    "*",
    securityMiddleware({
      token: opts.token,
      cookieName: () => `codeden_token_${port}`,
      allowedOrigins: () => origins,
      publicPaths: new Set(["/api/health"]),
    }),
  );
  const api = createApi({
    db: database.db,
    store,
    settings,
    runner: () => runner,
    runnerStatus,
    startedAt,
    shutdown: ({ stopRunner }) => {
      setTimeout(() => {
        void close({ stopRunner }).then(() => opts.onShutdownRequest?.());
      }, 50);
    },
  });
  app.route("/api", api);
  app.get(
    "/ws",
    upgradeWebSocket(() => hub.handlers()),
  );
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

  if (opts.runner !== false) {
    const launch =
      opts.runner ?? defaultRunnerLaunch(opts.enableFakeProvider ? ["--fake"] : []) ?? null;
    runner = new RunnerClient({
      home: paths.home,
      lockFile: paths.runnerLock,
      db: database.db,
      store,
      launch,
      onStatus: (status) => hub.broadcastRunner(status),
      log,
    });
    const started = runner.start();
    if (opts.waitForRunner) await started;
    else started.catch((error: unknown) => log(`runner: ${String(error)}`));
  }

  async function close(closeOpts: { stopRunner?: boolean } = {}): Promise<void> {
    closing ??= (async () => {
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
    runner,
    close,
  };
}

/** Type of the HTTP API for the Hono RPC client (`hc<AppType>(baseUrl + "/api")`). */
export type AppType = ReturnType<typeof createApi>;
