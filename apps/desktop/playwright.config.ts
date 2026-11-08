import { defineConfig } from "@playwright/test";

/**
 * Desktop smoke test (`pnpm e2e:desktop` from the repo root): launches the unpacked app built
 * for this OS with Playwright's Electron support, against an isolated home and the Fake
 * provider.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
