/**
 * `codeden` CLI (§16): start the server (which ensures the runner) and open the browser.
 *   codeden [--port <n>] [--home <dir>] [--no-open]
 *   codeden doctor [--install]
 *   codeden update [--rollback]
 *   codeden stop
 * Loaded by `cli.ts` once the launcher has picked the version to run.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CODEDEN_VERSION } from "@codeden/contracts";
import {
  ensureHome,
  ensureInstallToken,
  type RunningServer,
  resolveHome,
  startServer,
} from "@codeden/server";
import { doctor } from "./doctor";
import type { LaunchInfo } from "./launcher";
import { openBrowser } from "./open-browser";
import { handOver } from "./restart";
import { findRunningServer } from "./running";
import { stop } from "./stop";
import { updateCommand } from "./update-command";

const DEFAULT_PORT = 4317;

const HELP = `codeden ${CODEDEN_VERSION}: a local-first harness for coding agents

Usage:
  codeden [options]      Start CodeDen and open it in the browser
  codeden doctor         Check the installation (--install: add Claude Code support now)
  codeden update         Install the latest version and switch to it (--rollback: go back)
  codeden stop           Stop the server and the runner

Options:
  --port <n>     Port to listen on (default ${DEFAULT_PORT})
  --home <dir>   Data directory (default ~/.codeden, or CODEDEN_HOME)
  --no-open      Do not open the browser
  -v, --version  Print the version
  -h, --help     Show this help
`;

/** What the launcher recorded; a plain workspace run (tests) counts as a source checkout. */
function launchInfo(home: string): LaunchInfo {
  const info = (globalThis as Record<string, unknown>).__CODEDEN_LAUNCH__ as LaunchInfo | undefined;
  return (
    info ?? {
      binEntry: process.argv[1] ?? "",
      binVersion: CODEDEN_VERSION,
      kind: "source",
      source: "source",
      restartCommand: "codeden",
      home,
      warning: null,
    }
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      home: { type: "string" },
      "no-open": { type: "boolean", default: false },
      install: { type: "boolean", default: false },
      rollback: { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(CODEDEN_VERSION);
    return 0;
  }
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 24) {
    console.error(`CodeDen needs Node.js 24 or newer (found ${process.versions.node}).`);
    return 1;
  }

  const home = resolveHome(values.home);
  const launch = launchInfo(home);
  const command = positionals[0];
  if (command === "doctor") return doctor(home, { install: values.install, launch });
  if (command === "stop") return stop(home);
  if (command === "update") return updateCommand(home, { rollback: values.rollback, launch });
  if (command) {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 2;
  }

  const paths = ensureHome(home);
  const token = ensureInstallToken(paths.token);
  const running = await findRunningServer(paths.serverLock);
  if (running) {
    const url = `http://127.0.0.1:${running.port}/?token=${token}`;
    console.log(`CodeDen is already running: ${url}`);
    if (!values["no-open"]) openBrowser(url);
    return 0;
  }

  const port = values.port ? Number(values.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port "${values.port}".`);
    return 2;
  }
  let server: RunningServer;
  const shutdown = () => void server.close().then(() => process.exit(0));
  try {
    server = await startServer({
      port,
      dataDir: home,
      token,
      enableFakeProvider: process.env.CODEDEN_FAKE_PROVIDER === "1",
      onShutdownRequest: () => process.exit(0),
      selfUpdate: {
        source: launch.source,
        restartCommand: launch.restartCommand,
        launcherVersion: launch.binVersion,
        warning: launch.warning,
        restart:
          launch.source === "packaged"
            ? (target) => {
                process.off("SIGINT", shutdown);
                process.off("SIGTERM", shutdown);
                void handOver({
                  server,
                  home,
                  args,
                  target,
                  fromVersion: CODEDEN_VERSION,
                  launch,
                  selfEntry: join(import.meta.dirname, "cli.js"),
                }).then((code) => process.exit(code));
              }
            : undefined,
      },
      log: (m) => {
        if (process.env.CODEDEN_DEBUG) console.log(`[codeden] ${m}`);
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Port ${port} is in use. Try: codeden --port ${port + 1}`);
      return 1;
    }
    throw error;
  }

  console.log(`CodeDen ${CODEDEN_VERSION} is running at ${server.url}`);
  console.log(`Open: ${server.launchUrl}`);
  console.log("Press Ctrl+C to stop the server (agents keep running in the runner).");
  if (!values["no-open"]) openBrowser(server.launchUrl);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return new Promise<number>(() => {});
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
