import { expect, type Page, test } from "@playwright/test";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`global setup did not set ${name}`);
  return value;
};

/** JSON call to the server under test with the install token. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const res = await page.request.fetch(`${env("CODEDEN_E2E_URL")}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${env("CODEDEN_E2E_TOKEN")}` },
    data: body,
  });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

type SnapshotSession = { id: string; projectId: string; role: string; archivedAt?: string | null };

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

const archivedCount = async (page: Page, project: string) => {
  const snap = await api<{ sessions: SnapshotSession[] }>(page, "GET", "/snapshot");
  return snap.sessions.filter((s) => s.projectId === project && s.role === "agent" && s.archivedAt)
    .length;
};

test("archive a session from its right-click menu, find it under archived, unarchive it", async ({
  page,
}) => {
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete");
  const project = await projectId(page);
  const title = `Archive me from the sidebar ${Date.now()}`;
  const started = await api<{ status: string; sessionId: string }>(page, "POST", "/sessions", {
    projectId: project,
    provider: "fake",
    purpose: title,
    workKey: `task:e2e-archive-${Date.now()}`,
  });
  expect(started.status).toBe("started");
  const before = await archivedCount(page, project);

  await page.evaluate((id) => {
    const state = { expandedProjects: { [id]: true } };
    localStorage.setItem("codeden.layout", JSON.stringify({ state, version: 0 }));
  }, project);
  await page.goto(`${env("CODEDEN_E2E_URL")}/projects/${project}`);

  const sidebar = page.locator("aside").first();
  const group = sidebar.locator(`[data-project-id="${project}"]`);
  const row = group.locator(`[data-session-id="${started.sessionId}"]`);
  const archivedRow = group.getByRole("link", { name: `${before + 1} archived` });

  await test.step("right-click the session and archive it", async () => {
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    const menu = page.getByRole("menu");
    for (const item of ["Open", "Rename", "Copy link", "Archive"]) {
      await expect(menu.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
    }
    await menu.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(page.getByText(/^Session archived/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  await test.step("the project lists it under archived", async () => {
    await expect(archivedRow).toBeVisible();
    await archivedRow.click();
    await expect(page).toHaveURL(/archived=true/);
    await expect(page.getByRole("tab", { name: /^Archived · / })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("main").getByText(title)).toBeVisible();
  });

  await test.step("unarchive brings it back to the sidebar", async () => {
    await page.getByRole("button", { name: `Unarchive ${title}` }).click();
    await expect(page.getByText("Session restored to the sidebar")).toBeVisible();
    await expect(row).toBeVisible();
    await expect(page.locator("main").getByText(title)).toHaveCount(0);
    expect(await archivedCount(page, project)).toBe(before);
  });

  await api(page, "POST", `/sessions/${started.sessionId}/stop`, {});
});
