import { configDefaults, defineConfig } from "vitest/config";

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
  "test/sessions.test.ts",
  "test/pty.test.ts",
];
const SERVER_PROCESS_TESTS = [
  "test/runner-lifecycle.test.ts",
  "test/runner-e2e.test.ts",
  "test/restart-recovery.test.ts",
  "test/browser.test.ts",
];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      "packages/*",
      "apps/web",
      "apps/cli",
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
