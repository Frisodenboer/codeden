import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Tests make temp folders under `os.tmpdir()` and compare paths the server and runner
 * canonicalise with `realpath`. On CI runners the temp dir is not canonical: macOS uses
 * `/var/folders/...` (a symlink to `/private/var/...`) and Windows uses an 8.3 short name
 * (`C:\Users\RUNNER~1\...`). Point every worker (and the processes they spawn) at the
 * canonical temp dir so expectations and results agree. `os.tmpdir()` reads these variables
 * on every call.
 */
const canonicalTmp = realpathSync.native(tmpdir());
for (const name of process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"]) {
  process.env[name] = canonicalTmp;
}

/**
 * Suites that drive real processes with timing-sensitive waits: Chromium, terminals, Fake
 * turns in worktrees, dev-server discovery and detached runner processes. Run in parallel
 * with everything else they compete for CPU and process start-up (PowerShell, netstat, tsx)
 * and their waits time out on a loaded machine. They run after the parallel batch
 * (`groupOrder: 1`), one file at a time per package.
 */
const RUNNER_PROCESS_TESTS = [
  "test/browser-engine.test.ts",
  "test/browser-agent.test.ts",
  "test/browser-native.test.ts",
  "test/sessions.test.ts",
  "test/pty.test.ts",
];
const SERVER_PROCESS_TESTS = [
  "test/runner-lifecycle.test.ts",
  "test/runner-e2e.test.ts",
  "test/restart-recovery.test.ts",
  "test/browser.test.ts",
  "test/browser-native.test.ts",
];
const DESKTOP_PROCESS_TESTS = ["test/relay-chromium.test.ts"];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      "packages/*",
      "apps/web",
      "apps/cli",
      {
        test: {
          name: "@codeden/desktop",
          root: "apps/desktop",
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...DESKTOP_PROCESS_TESTS],
        },
      },
      {
        test: {
          name: "@codeden/desktop (processes)",
          root: "apps/desktop",
          include: DESKTOP_PROCESS_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      { test: { name: "scripts", root: "scripts", include: ["**/*.test.mjs"] } },
      {
        test: {
          name: "@codeden/runner",
          root: "apps/runner",
          exclude: [...configDefaults.exclude, ...RUNNER_PROCESS_TESTS],
        },
      },
      {
        test: {
          name: "@codeden/runner (processes)",
          root: "apps/runner",
          include: RUNNER_PROCESS_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: "./apps/server/vitest.config.ts",
        test: {
          name: "@codeden/server",
          root: "apps/server",
          exclude: [...configDefaults.exclude, ...SERVER_PROCESS_TESTS],
        },
      },
      {
        extends: "./apps/server/vitest.config.ts",
        test: {
          name: "@codeden/server (processes)",
          root: "apps/server",
          include: SERVER_PROCESS_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
