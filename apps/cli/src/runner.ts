/**
 * Runner process entry for the published package (`dist/runner.js`), started detached by the
 * server. Records this package's version for the bundle (the runner reports it in the
 * handshake, so a server of another version drains and replaces it, §4.2), then loads the runner.
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
import("@codeden/runner/main").catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
