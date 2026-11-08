import { readFileSync } from "node:fs";
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

// Named to run after the m1 spec, which needs a server that has not finished setup yet.
test.beforeEach(async ({ page }) => {
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete", {});
});

test("create an automation in the editor, export it, delete it and import it back, off", async ({
  page,
}) => {
  const project = await projectId(page);
  const base = env("CODEDEN_E2E_URL");
  const name = `Nightly lint report ${Date.now().toString(36)}`;
  let file = "";

  await test.step("create it from scratch: schedule, prompt, read-only permissions", async () => {
    await page.goto(`${base}/projects/${project}/automations`);
    await page.getByRole("link", { name: "New automation" }).first().click();
    const editor = page.getByTestId("automation-editor");
    await editor.getByLabel("Name").fill(name);
    await expect(editor.getByTestId("schedule-summary")).toHaveText("Every weekday at 09:00");
    await editor.getByRole("combobox", { name: "How often" }).click();
    await page.getByRole("option", { name: "Daily" }).click();
    await editor.getByLabel("Time", { exact: true }).fill("02:15");
    await expect(editor.getByTestId("schedule-summary")).toHaveText("Every day at 02:15");
    await expect(editor.getByTestId("cron-preview")).toContainText("Next:");
    await editor.locator(".cm-content").click();
    await page.keyboard.type("Run the linter on ");
    await editor.getByRole("button", { name: "Insert placeholder" }).click();
    await page.getByRole("menuitem", { name: /Project name/ }).click();
    await expect(editor.locator(".cm-content")).toContainText("{{project.name}}");
    await editor
      .getByTestId("permissions-field")
      .getByRole("button", { name: /Read-only/ })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/automations\/(?!new)[^/]+$/);
    await expect(page.getByText(`${name} saved, off`)).toBeVisible();
  });

  await test.step("export it as Markdown", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/ }).click();
    await page.getByRole("menuitem", { name: "Download .md" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^nightly-lint-report-.+\.md$/);
    const path = await saved.path();
    file = readFileSync(path, "utf8");
    expect(file).toContain(`name: ${name}`);
    expect(file).toContain("expression: 15 2 * * *");
    expect(file).toContain("autonomy: read_only");
    expect(file).toContain("Run the linter on {{project.name}}");
  });

  await test.step("delete it", async () => {
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByTestId("automation-row").filter({ hasText: name })).toHaveCount(0);
  });

  await test.step("import the file back: previewed, then listed off", async () => {
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByTestId("import-dialog");
    await dialog.getByTestId("import-file-input").setInputFiles({
      name: "shared.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(file),
    });
    const row = dialog.getByTestId("import-preview-row");
    await expect(row).toContainText(name);
    await expect(row).toContainText("Every day at 02:15");
    await expect(row).toContainText("Read-only");
    await dialog.getByRole("button", { name: /Import 1 of 1, off/ }).click();
    const listed = page.getByTestId("automation-row").filter({ hasText: name });
    await expect(listed).toBeVisible();
    await expect(listed.getByRole("switch")).not.toBeChecked();
    await expect(listed).toContainText("Imported");
  });
});
