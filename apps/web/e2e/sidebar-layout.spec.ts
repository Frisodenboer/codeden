import { expect, type Locator, type Page, test } from "@playwright/test";

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

/** True when the element ends inside `right` (a pixel of rounding allowed). */
async function endsBefore(locator: Locator, right: number): Promise<boolean> {
  const box = await locator.boundingBox();
  return box !== null && box.width > 0 && box.x + box.width <= right + 1;
}

/** The text is cut with an ellipsis rather than overflowing. */
const isTruncated = (locator: Locator) =>
  locator.evaluate(
    (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis",
  );

const LONG_TITLE =
  "Rework the checkout flow so that saved addresses, gift cards and split payments all work together";

test("the sidebar truncates long titles and keeps trailing details at its narrowest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete");
  const project = await projectId(page);
  const started = await api<{ status: string; sessionId: string }>(page, "POST", "/sessions", {
    projectId: project,
    provider: "fake",
    purpose: LONG_TITLE,
    workKey: `task:e2e-narrow-${Date.now()}`,
  });
  expect(started.status).toBe("started");

  // The narrowest sidebar, with the project expanded and the right panel open.
  await page.evaluate((id) => {
    const state = { sidebarWidth: 220, expandedProjects: { [id]: true }, rightOpen: true };
    localStorage.setItem("codeden.layout", JSON.stringify({ state, version: 0 }));
  }, project);
  await page.goto(`${env("CODEDEN_E2E_URL")}/sessions/${started.sessionId}`);

  const sidebar = page.locator("aside").first();
  const scroller = sidebar.getByTestId("sidebar-projects");
  const group = sidebar.locator(`[data-project-id="${project}"]`);
  const row = group.getByRole("link", { name: new RegExp(LONG_TITLE.slice(0, 30)) });
  await expect(row).toBeVisible();
  const right = await sidebar.evaluate((el) => el.getBoundingClientRect().right);

  await test.step("nothing scrolls sideways", async () => {
    const viewport = scroller.locator("[data-slot=scroll-area-viewport]");
    const widths = await viewport.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1] ?? 0);
  });

  await test.step("the session title ends in an ellipsis and its age stays visible", async () => {
    await expect.poll(() => isTruncated(row.locator("span.truncate"))).toBe(true);
    const age = row.locator("span").last();
    await expect(age).toBeVisible();
    expect(await endsBefore(age, right)).toBe(true);
  });

  await test.step("the PM badge and the automations count stay inside the sidebar", async () => {
    const pm = group.getByRole("link", { name: /Project manager/ });
    const badge = pm.getByText("PM", { exact: true });
    await expect(badge).toBeVisible();
    expect(await endsBefore(badge, right)).toBe(true);
    const on = group.getByTestId("sidebar-automations-on");
    await expect(on).toBeVisible();
    expect(await endsBefore(on, right)).toBe(true);
    const chevron = group.getByRole("button", { name: /automations/ });
    expect(await endsBefore(chevron, right)).toBe(true);
  });

  await test.step("project rows with the drag grip and menu keep the same bounds", async () => {
    const head = group.locator("> div").first();
    await head.hover();
    const menu = head.getByRole("button", { name: / actions$/ });
    await expect(menu).toBeVisible();
    expect(await endsBefore(menu, right)).toBe(true);
  });

  await test.step("the thread header truncates the title instead of overflowing", async () => {
    const header = page.locator("main header").first();
    const title = header.getByRole("heading", { level: 1 });
    await expect(title).toHaveText(LONG_TITLE);
    await expect.poll(() => isTruncated(title)).toBe(true);
    const widths = await header.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1] ?? 0);
  });

  await api(page, "POST", `/sessions/${started.sessionId}/stop`, {});
});
