#!/usr/bin/env node
/**
 * `codeden` CLI (§16): start the server (which ensures the runner) and open the browser.
 *   codeden [--port <n>] [--home <dir>] [--no-open]
 *   codeden doctor [--install]
 *   codeden stop
 */
import { parseArgs } from "node:util";
import { CODEDEN_VERSION } from "@codeden/contracts";
import { ensureHome, ensureInstallToken, resolveHome, startServer } from "@codeden/server";
import { doctor } from "./doctor";
import { openBrowser } from "./open-browser";
import { findRunningServer } from "./running";
import { stop } from "./stop";

const DEFAULT_PORT = 4317;

const HELP = `codeden ${CODEDEN_VERSION}: a local-first harness for coding agents

Usage:
  codeden [options]      Start CodeDen and open it in the browser
  codeden doctor         Check the installation (--install: add Claude Code support now)
  codeden stop           Stop the server and the runner

Options:
  --port <n>     Port to listen on (default ${DEFAULT_PORT})
  --home <dir>   Data directory (default ~/.codeden, or CODEDEN_HOME)
  --no-open      Do not open the browser
  -v, --version  Print the version
  -h, --help     Show this help
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      home: { type: "string" },
      "no-open": { type: "boolean", default: false },
      install: { type: "boolean", default: false },
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
  const command = positionals[0];
  if (command === "doctor") return doctor(home, { install: values.install });
  if (command === "stop") return stop(home);
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
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      port,
      dataDir: home,
      token,
      enableFakeProvider: process.env.CODEDEN_FAKE_PROVIDER === "1",
      onShutdownRequest: () => process.exit(0),
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

  const shutdown = () => void server.close().then(() => process.exit(0));
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
