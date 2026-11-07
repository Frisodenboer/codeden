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
  const json = (await res.json().catch(() => null)) as T;
  expect(res.status(), `${method} ${path}: ${JSON.stringify(json)}`).toBeLessThan(300);
  return json;
}

/** The demo repo's project (created by an earlier spec, or here). */
async function projectId(page: Page): Promise<string> {
  const repo = env("CODEDEN_E2E_REPO");
  const snap = await api<{ projects: { id: string; path: string }[] }>(page, "GET", "/snapshot");
  const norm = (p: string) => p.replaceAll("\\", "/").toLowerCase();
  const found = snap.projects.find((p) => norm(p.path) === norm(repo));
  if (found) return found.id;
  const created = await api<{ project: { id: string } }>(page, "POST", "/projects", {
    source: { type: "local", path: repo },
  });
  return created.project.id;
}

type Item = { automation: { id: string; templateId: string | null; name: string } };

async function automationFor(page: Page, project: string, templateId: string): Promise<Item> {
  const list = await api<{ automations: Item[] }>(page, "GET", `/automations?projectId=${project}`);
  const found = list.automations.find((i) => i.automation.templateId === templateId);
  if (!found) throw new Error(`no ${templateId} automation in the project`);
  return found;
}

test.beforeEach(async ({ page }) => {
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete", {});
  await api(page, "PATCH", "/settings", { automations: { enabled: true } });
});

test("a template added on a project runs now on the Fake provider and shows in history", async ({
  page,
}) => {
  const project = await projectId(page);
  const base = env("CODEDEN_E2E_URL");

  await test.step("add the refactor sweep from the templates gallery, enabled", async () => {
    await page.goto(`${base}/projects/${project}/automations?tab=templates`);
    const card = page.locator('[data-template="refactor-sweep"]');
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Add and enable" }).click();
    await expect(card.getByText("In this project")).toBeVisible();
  });

  await test.step("the automations list shows it on, with a human schedule", async () => {
    await page.getByRole("tab", { name: "Automations" }).click();
    const row = page.getByTestId("automation-row").filter({ hasText: "Refactor sweep" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("switch", { name: "Enable Refactor sweep" })).toBeChecked();
    await expect(row).toContainText("Monthly on the 1st and 15th at 04:00");
    await row.getByRole("link", { name: "Refactor sweep" }).click();
  });

  await test.step("pick the Fake provider and a manual trigger in the editor, then save", async () => {
    const editor = page.getByTestId("automation-editor");
    await expect(editor.getByTestId("cron-preview")).toContainText("Next:");
    await editor.getByRole("button", { name: "Manual", exact: true, pressed: false }).click();
    await editor.getByRole("button", { name: "Provider and model" }).click();
    await page.getByRole("menuitem").first().click();
    await expect(editor.getByRole("button", { name: "Provider and model" })).toContainText(/Fake/i);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Automation saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  await test.step("run now: the run appears in history linked to its session", async () => {
    const schedule = page.getByTestId("schedule-card");
    await schedule.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByText("Run started")).toBeVisible();
    const run = page.getByTestId("run-row").first();
    await expect(run).toBeVisible();
    const link = run.getByTestId("run-session-link");
    await expect(link).toBeVisible();
    await expect(run).toHaveAttribute("data-status", /running|completed/);
    await link.click();
    await expect(page).toHaveURL(/\/sessions\//);
    await expect(page.getByText(/^Echo: /).first()).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the run completes when its session goes idle", async () => {
    await page.goto(`${base}/projects/${project}/automations?tab=runs`);
    const run = page.getByTestId("run-row").filter({ hasText: "Refactor sweep" }).first();
    await expect(run).toHaveAttribute("data-status", "completed", { timeout: 30_000 });
  });
});

test("skip the next scheduled run from Now / Next, and see PM skips live", async ({ page }) => {
  const project = await projectId(page);
  const audit = await automationFor(page, project, "security-audit");
  const deps = await automationFor(page, project, "dependency-updates");
  for (const item of [audit, deps]) {
    await api(page, "POST", `/automations/${item.automation.id}/enable`, {});
  }

  await page.goto(`${env("CODEDEN_E2E_URL")}/projects/${project}`);
  const next = page.getByTestId("next-runs");

  await test.step("the upcoming runs come from the scheduler", async () => {
    await expect(next.getByTestId("next-run").filter({ hasText: "Security audit" })).toHaveCount(1);
    await expect(
      next.getByTestId("next-run").filter({ hasText: "Dependency updates" }),
    ).toHaveCount(1);
  });

  await test.step("skip one inline: it is marked skipped and the following run is listed", async () => {
    await next.getByRole("button", { name: "Skip the next Security audit run" }).click();
    await expect(page.getByText(/Skipped the .* run/)).toBeVisible();
    const rows = next.getByTestId("next-run").filter({ hasText: "Security audit" });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-skipped", "true");
    await expect(rows.first()).toContainText("Skipped");
  });

  await test.step("a skip made elsewhere (the PM, the API) shows up without a reload", async () => {
    await api(page, "POST", `/automations/${deps.automation.id}/skip-next`, { projectId: project });
    const rows = next.getByTestId("next-run").filter({ hasText: "Dependency updates" });
    await expect(rows.first()).toHaveAttribute("data-skipped", "true");
  });

  for (const item of [audit, deps]) {
    await api(page, "POST", `/automations/${item.automation.id}/disable`, {});
  }
});
