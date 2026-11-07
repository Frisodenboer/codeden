import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real server + runner with the Fake provider (`e2e/`). Run with
 * `pnpm e2e` from the repo root, which builds the web app first (the server serves `dist/`).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
