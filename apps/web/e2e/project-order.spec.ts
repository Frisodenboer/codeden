import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

/** Add a plain folder as a project; new projects go to the end of the unpinned group. */
async function addProject(page: Page, name: string): Promise<string> {
  const folder = join(env("CODEDEN_E2E_USER_HOME"), "order-projects", name);
  mkdirSync(folder, { recursive: true });
  const created = await api<{ project: { id: string } }>(page, "POST", "/projects", {
    source: { type: "local", path: folder },
  });
  return created.project.id;
}

/** Ids of the project rows inside a sidebar group, top to bottom. */
const rowIds = (group: Locator) =>
  group
    .locator("[data-project-id]")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-project-id") ?? ""));

/** Drag one project row onto another with the mouse, in small steps like a person would. */
async function dragRow(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("rows are not visible");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 10, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 12 });
  await page.mouse.up();
}

test("pin a project, reorder by drag, and keep the order after a reload", async ({ page }) => {
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete");
  const alpha = await addProject(page, "order-alpha");
  const beta = await addProject(page, "order-beta");
  const gamma = await addProject(page, "order-gamma");
  await page.goto(new URL("/", env("CODEDEN_E2E_URL")).href);

  const sidebar = page.locator("aside").first();
  const projects = sidebar.getByRole("region", { name: "Projects", exact: true });
  const pinned = sidebar.getByRole("region", { name: "Pinned projects" });
  const head = (id: string) => sidebar.locator(`[data-project-id="${id}"] > div`).first();
  const ours = async (group: Locator) =>
    (await rowIds(group)).filter((id) => [alpha, beta, gamma].includes(id));

  await test.step("new projects arrive at the bottom in creation order", async () => {
    await expect.poll(() => ours(projects)).toEqual([alpha, beta, gamma]);
  });

  await test.step("pin order-gamma from its row menu", async () => {
    await head(gamma).hover();
    await sidebar.getByRole("button", { name: "order-gamma actions" }).click();
    await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
    await expect(pinned).toBeVisible();
    await expect.poll(() => ours(pinned)).toEqual([gamma]);
    await expect.poll(() => ours(projects)).toEqual([alpha, beta]);
  });

  await test.step("drag order-beta above order-alpha", async () => {
    await dragRow(page, head(beta), head(alpha));
    await expect.poll(() => ours(projects)).toEqual([beta, alpha]);
  });

  await test.step("a click still expands a project after dragging", async () => {
    const toggle = head(beta).getByRole("button", { name: "order-beta", exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("the order and the pin survive a reload", async () => {
    await page.reload();
    await expect(pinned).toBeVisible();
    await expect.poll(() => ours(pinned)).toEqual([gamma]);
    await expect.poll(() => ours(projects)).toEqual([beta, alpha]);
    const listed = await api<{ id: string; pinned: boolean }[]>(page, "GET", "/projects");
    const order = listed.map((p) => p.id).filter((id) => [alpha, beta, gamma].includes(id));
    expect(order).toEqual([gamma, beta, alpha]);
    expect(listed.find((p) => p.id === gamma)?.pinned).toBe(true);
  });

  await test.step("tidy up: unpin so later specs see a plain list", async () => {
    await api(page, "PATCH", `/projects/${gamma}`, { pinned: false });
  });
});
