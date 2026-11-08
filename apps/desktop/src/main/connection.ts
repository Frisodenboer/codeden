import { join } from "node:path";
import type { DesktopUpdateCommand } from "@codeden/contracts";
import type { LaunchArgs } from "./args";
import { DEFAULT_PORT } from "./args";
import { homeFiles, planServer, readToken } from "./server-plan";
import { ServerProcess, type ServerReady, ServerStartError } from "./server-process";

/** How the app reached its server. */
export interface Connection {
  url: string;
  token: string;
  version: string;
  /** The server the app started (null when it attached to one started by `codeden`). */
  server: ServerProcess | null;
}

export interface ConnectOptions {
  args: LaunchArgs;
  /** `dist/server.js`. */
  serverEntry: string;
  onUpdateCommand: (id: string, command: DesktopUpdateCommand) => void;
  onUnexpectedExit: (code: number | null) => void;
  log: (message: string) => void;
}

/**
 * Attach to the server already running for this home, or start one (§17). A server the app
 * starts listens on `--port`, else 4317, else any free port when 4317 is taken.
 */
export async function connect(opts: ConnectOptions): Promise<Connection> {
  const { args, log } = opts;
  const plan = await planServer(args.home);
  const token = plan.kind === "attach" ? readToken(args.home) : null;
  if (plan.kind === "attach" && token) {
    log(`server: attaching to pid ${plan.lock.pid} on port ${plan.lock.port}`);
    return {
      url: `http://127.0.0.1:${plan.lock.port}`,
      token,
      version: plan.lock.version,
      server: null,
    };
  }
  const ports = args.port !== null ? [args.port] : [DEFAULT_PORT, 0];
  let lastError: unknown;
  for (const port of ports) {
    const server = new ServerProcess({
      entry: opts.serverEntry,
      home: args.home,
      port,
      fake: args.fake,
      logFile: join(homeFiles(args.home).logs, "desktop-server.log"),
      onUpdateCommand: opts.onUpdateCommand,
      onUnexpectedExit: opts.onUnexpectedExit,
      log,
    });
    try {
      const ready: ServerReady = await server.start();
      const started = readToken(args.home);
      if (!started) throw new Error("The server started without an install token");
      return { url: ready.url, token: started, version: ready.version, server };
    } catch (error) {
      lastError = error;
      const inUse = error instanceof ServerStartError && error.code === "EADDRINUSE";
      log(`server: could not start on port ${port}: ${String(error)}`);
      if (!inUse) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** The window URL for a UI route: the token is exchanged for a cookie and dropped by a redirect. */
export function launchUrl(conn: Pick<Connection, "url" | "token">, path = "/"): string {
  const url = new URL(path, conn.url);
  url.searchParams.set("token", conn.token);
  return url.href;
}
