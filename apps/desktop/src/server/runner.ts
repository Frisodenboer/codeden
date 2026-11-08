/**
 * Runner entry for the desktop app (`dist/runner.js`), started detached by the server on the
 * app's Electron binary as Node.js (§4.2, §17). Records the app version for the handshake
 * (a server of another version drains and replaces this runner), clears the variable that
 * makes Electron act as Node.js so shells and agents never inherit it, then loads the runner.
 */
import { readFileSync } from "node:fs";

function ownVersion(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

(globalThis as Record<string, unknown>).__CODEDEN_PACKAGE_VERSION__ = ownVersion();
delete process.env.ELECTRON_RUN_AS_NODE;
import("@codeden/runner/main").catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
