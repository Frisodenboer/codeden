/**
 * Server entry for the desktop app (`dist/server.js`), forked by the main process on the
 * Electron binary as Node.js (§17). Starts the same server `codeden` runs, with the desktop
 * updater as its self-update host, and talks to the main process over Node IPC
 * (`DesktopServerMessage` / `DesktopHostMessage`).
 *
 *   server.js --home <dir> [--port <n>] [--fake]
 *
 * Like the CLI entry, it records the package version before anything reads it, so the
 * rest of the bundle is loaded with `import()`.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

function ownVersion(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

(globalThis as Record<string, unknown>).__CODEDEN_PACKAGE_VERSION__ = ownVersion();
// Spawns of our own scripts add it back explicitly (`ownNodeEnv`); the user's tools never see it.
delete process.env.ELECTRON_RUN_AS_NODE;
// There is no npm in the app: Claude Code support is fetched from the registry (§17).
process.env.CODEDEN_DEPS_INSTALLER ??= "registry";

const { values } = parseArgs({
  options: {
    home: { type: "string" },
    port: { type: "string", default: "0" },
    fake: { type: "boolean", default: false },
  },
});

import("./serve")
  .then(({ serve }) =>
    serve({ home: values.home, port: Number(values.port), fake: values.fake === true }),
  )
  .catch((error: unknown) => {
    const err = error as NodeJS.ErrnoException;
    process.send?.({
      type: "failed",
      message: err instanceof Error ? err.message : String(error),
      code: typeof err?.code === "string" ? err.code : null,
    });
    console.error(error);
    process.exit(1);
  });
