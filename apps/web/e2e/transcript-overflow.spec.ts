import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`global setup did not set ${name}`);
  return value;
};

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const res = await page.request.fetch(`${env("CODEDEN_E2E_URL")}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${env("CODEDEN_E2E_TOKEN")}` },
    data: body,
  });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** A small committed repo of its own, so this spec does not depend on the others. */
function tempRepo(): string {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-e2e-overflow-")));
  const repo = join(base, "overflow-demo");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "ignore" });
  git("config", "user.email", "e2e@codeden.test");
  git("config", "user.name", "CodeDen E2E");
  writeFileSync(join(repo, "README.md"), "# Overflow demo\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return repo;
}

/**
 * How far each horizontally scrollable surface of the thread overflows (the main panel, the
 * transcript scroller and every row button), and how many elements stick out past the
 * transcript column, where its safety net would clip them. All must be 0.
 */
function overflow(page: Page) {
  return page.evaluate(() => {
    const over = (el: Element | null) => (el ? el.scrollWidth - el.clientWidth : -1);
    const scroller = document.querySelector('[data-testid="transcript-scroll"]');
    const column = scroller?.firstElementChild;
    if (!scroller || !column) throw new Error("transcript not rendered");
    const rows = [...scroller.querySelectorAll("button[aria-expanded]")];
    const edge =
      column.getBoundingClientRect().right -
      Number.parseFloat(getComputedStyle(column).paddingRight);
    const clipped = [...column.querySelectorAll("*")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > edge + 1;
    }).length;
    return {
      main: over(document.querySelector("main")),
      transcript: over(scroller),
      rows: Math.max(0, ...rows.map(over)),
      clipped,
    };
  });
}

const NO_OVERFLOW = { main: 0, transcript: 0, rows: 0, clipped: 0 };

/** An unbroken URL in the prompt: it shows in the user bubble and in the echoed markdown reply. */
const LONG_URL = `https://example.com/builds/${"a1b2c3d4".repeat(40)}`;

const VIEWPORTS = [
  { name: "wide", width: 1440, height: 900 },
  { name: "narrow", width: 1024, height: 800 },
] as const;

test("a very long MCP tool result never makes the transcript scroll sideways", async ({
  page,
}, testInfo) => {
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete", {});
  const { project } = await api<{ project: { id: string } }>(page, "POST", "/projects", {
    source: { type: "local", path: tempRepo() },
  });
  const started = await api<{ status: string; sessionId: string }>(page, "POST", "/sessions", {
    projectId: project.id,
    provider: "fake",
    purpose: "Transcript overflow e2e",
    workKey: `task:e2e-overflow-${Date.now()}`,
    input: { text: `Triage issue 3 [mcp] ${LONG_URL}` },
  });
  expect(started.status).toBe("started");

  await page.goto(`${new URL(env("CODEDEN_E2E_URL")).origin}/sessions/${started.sessionId}`);
  await expect(page.getByText("Echo: Triage issue 3 [mcp]")).toBeVisible();
  // The follow-up chips arrive with the end of the turn.
  await expect(page.getByRole("button", { name: "Add tests" })).toBeVisible();

  const scroller = page.getByTestId("transcript-scroll");
  await scroller.getByRole("button", { name: /Ran 1 command and called 1 tool/ }).click();
  const row = scroller.getByRole("button", { name: /codeden: triage_issue/ });
  await expect(row).toBeVisible();

  await test.step("the collapsed row shows a short summary, not the raw JSON", async () => {
    await expect(row).toContainText("Discover the real model list without running a session first");
    await expect(row).not.toContainText('"projectId"');
  });

  for (const viewport of VIEWPORTS) {
    await test.step(`no horizontal overflow at ${viewport.width}px`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if ((await row.getAttribute("aria-expanded")) === "true") await row.click();
      await expect(row.getByText("12ms")).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-collapsed.png`) });
      expect.soft(await overflow(page)).toEqual(NO_OVERFLOW);

      // Expanded, the full output (with its long unbroken tokens) wraps inside the column.
      await row.click();
      const details = row.locator("xpath=following-sibling::div[1]");
      await expect(details).toContainText('"projectId"');
      await expect(details).toContainText("c0dec0de");
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-expanded.png`) });
      expect.soft(await overflow(page)).toEqual(NO_OVERFLOW);
    });
  }
});
