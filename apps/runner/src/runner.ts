import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  CODEDEN_VERSION,
  RUNNER_PROTOCOL_VERSION,
  type RunnerEvent,
  RunnerLock,
} from "@codeden/contracts";
import { FakeProvider, type ProviderAdapter, ProviderRegistry } from "@codeden/providers";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { connectionHandlers, type RunnerCore, type ServerConnection } from "./connection";
import { Journal } from "./journal";
import { SessionHost } from "./session-host";

export interface StartRunnerOptions {
  /** CodeDen data directory; the runner uses `<home>/runner/`. */
  home: string;
  /** Load the scripted Fake provider (development and tests). */
  enableFakeProvider?: boolean;
  /** Extra adapters (tests). */
  adapters?: ProviderAdapter[];
  /** Port to listen on (127.0.0.1); 0 = random. */
  port?: number;
  /** Called after `runner.shutdown` has closed everything (the CLI exits the process). */
  onShutdown?: () => void;
  log?: (message: string) => void;
}

export interface RunningRunner {
  port: number;
  token: string;
  lockFile: string;
  close(): Promise<void>;
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Lock files owned by runners in this process. */
const activeLocks = new Set<string>();

/** Throw when another live runner owns this home. */
function assertSingleInstance(lockFile: string): void {
  if (activeLocks.has(lockFile)) throw new Error("Another runner is already running for this home");
  try {
    const lock = RunnerLock.parse(JSON.parse(readFileSync(lockFile, "utf8")));
    if (lock.pid !== process.pid && isAlive(lock.pid)) {
      throw new Error(`Another runner (pid ${lock.pid}) is already running for this home`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Another runner")) throw error;
  }
}

/**
 * Start the runner (§4.2): WebSocket server on 127.0.0.1, lock file with port/token/pid,
 * provider sessions and a durable journal. Survives server restarts.
 */
export async function startRunner(opts: StartRunnerOptions): Promise<RunningRunner> {
  const log = opts.log ?? (() => {});
  const dir = join(opts.home, "runner");
  mkdirSync(dir, { recursive: true });
  const lockFile = join(dir, "runner.json");
  assertSingleInstance(lockFile);

  const token = randomBytes(32).toString("hex");
  const journal = new Journal(dir);
  const registry = new ProviderRegistry(opts.adapters ?? []);
  if (opts.enableFakeProvider && !registry.get("fake"))
    registry.register(new FakeProvider({ delayMs: 15 }));

  const connections = new Set<ServerConnection>();
  let attached: ServerConnection | undefined;
  let draining = false;
  let closing: Promise<void> | undefined;

  const emit = (event: RunnerEvent) => {
    const msg = journal.append(event);
    attached?.deliver(msg);
  };
  const host = new SessionHost(registry, emit);
  const core: RunnerCore = {
    journal,
    host,
    registry,
    startedAt: new Date().toISOString(),
    isDraining: () => draining,
    drain: (reason) => {
      // TODO(M1): finish or pause running turns, then restart (§4.2).
      draining = true;
      emit({ kind: "runner.draining", reason });
    },
    shutdown: () => {
      setTimeout(() => void close().then(() => opts.onShutdown?.()), 50);
    },
  };

  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!LOOPBACK.test(c.req.header("host") ?? "")) return c.text("Forbidden host", 403);
    const auth = c.req.header("authorization") ?? "";
    const given = Buffer.from(auth.replace(/^Bearer\s+/i, ""));
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.text("Unauthorized", 401);
    }
    return next();
  });
  app.get("/health", (c) => c.json({ ok: true, version: CODEDEN_VERSION }));
  app.get(
    "/runner",
    upgradeWebSocket(() =>
      connectionHandlers(
        core,
        (conn) => connections.add(conn),
        (conn) => {
          connections.delete(conn);
          if (attached === conn) attached = undefined;
        },
        (conn) => {
          // A newer server connection replaces the previous one.
          if (attached && attached !== conn) attached.close("replaced by a new connection");
          attached = conn;
          log("server attached");
        },
      ),
    ),
  );

  const wss = new WebSocketServer({ noServer: true });
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve(
      { fetch: app.fetch, port: opts.port ?? 0, hostname: "127.0.0.1", websocket: { server: wss } },
      () => resolve(s),
    );
    s.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;

  const lock: RunnerLock = {
    pid: process.pid,
    port,
    token,
    version: CODEDEN_VERSION,
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runnerId: journal.runnerId,
    startedAt: core.startedAt,
    providers: registry.list().map((a) => a.id),
  };
  const tmp = `${lockFile}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, lockFile);
  activeLocks.add(lockFile);
  log(`runner ${journal.runnerId} listening on 127.0.0.1:${port}`);

  function removeLock(): void {
    try {
      const current = RunnerLock.parse(JSON.parse(readFileSync(lockFile, "utf8")));
      if (current.pid === process.pid) rmSync(lockFile, { force: true });
    } catch {
      // already gone
    }
  }
  process.once("exit", removeLock);

  async function close(): Promise<void> {
    closing ??= (async () => {
      await host.closeAll();
      for (const conn of connections) conn.close("runner stopping");
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ("closeAllConnections" in server) server.closeAllConnections();
      });
      removeLock();
      activeLocks.delete(lockFile);
      process.off("exit", removeLock);
    })();
    return closing;
  }

  return { port, token, lockFile, close };
}
