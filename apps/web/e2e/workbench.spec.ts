import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_CLAUDE_MD } from "./support/server";

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

let site: Server;
let siteUrl = "";

test.beforeAll(async () => {
  site = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><title>E2E Fixture Page</title><body style='margin:0;height:100vh;background:#1d4ed8' onclick=\"this.style.background='#16a34a'\"><h1 style='color:white;font:48px sans-serif;padding:40px'>Hello from the e2e page</h1></body>",
    );
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
});

test("the browser panel streams a page the session's browser opened", async ({ page }) => {
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  const project = await projectId(page);
  const started = await api<{ status: string; sessionId: string }>(page, "POST", "/sessions", {
    projectId: project,
    provider: "fake",
    purpose: "Browser panel e2e",
    workKey: `task:e2e-browser-${Date.now()}`,
  });
  expect(started.status).toBe("started");
  const id = started.sessionId;

  await test.step("a closed browser offers to open it", async () => {
    await page.goto(`${new URL(env("CODEDEN_E2E_URL")).origin}/sessions/${id}`);
    await expect(page.getByText("No messages yet")).toBeVisible();
    // Alt+3 opens the right panel on its Browser tab.
    await page.keyboard.press("Alt+3");
    await expect(page.getByTestId("browser-closed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open browser" })).toBeVisible();
  });

  await test.step("navigating through the API opens it and frames arrive", async () => {
    await api(page, "POST", `/sessions/${id}/browser/navigate`, { url: siteUrl });
    await expect(page.getByTestId("browser-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("browser-canvas")).toHaveAttribute("data-has-frame", "1", {
      timeout: 30_000,
    });
    await expect(page.getByLabel("Address")).toHaveValue(siteUrl);
    // The canvas really has pixels: the fixture page is blue.
    const blue = await page.getByTestId("browser-canvas").evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const [r, g, b] = c.getContext("2d")?.getImageData(5, c.height - 5, 1, 1).data ?? [];
      return (b ?? 0) > 150 && (r ?? 255) < 100 && (g ?? 255) < 150;
    });
    expect(blue).toBe(true);
  });

  /** The page's viewport as applied by the runner, and the panel's content box. */
  const sizes = () =>
    page.getByTestId("browser-viewport").evaluate((el) => ({
      applied: (el as HTMLElement).dataset.viewport ?? "",
      panel: `${el.clientWidth}x${el.clientHeight}@${Math.round(devicePixelRatio * 100) / 100}`,
    }));

  await test.step("the page is laid out at the panel's size and fills it edge to edge", async () => {
    await expect.poll(async () => (await sizes()).applied, { timeout: 15_000 }).not.toBe("");
    const { applied, panel } = await sizes();
    expect(applied).toBe(panel);
    const canvas = page.getByTestId("browser-canvas");
    await expect(canvas).toHaveAttribute("data-fit", "fill");
    const [canvasBox, panelBox] = await Promise.all([
      canvas.boundingBox(),
      page.getByTestId("browser-viewport").boundingBox(),
    ]);
    expect(canvasBox).toEqual(panelBox);
  });

  await test.step("clicks go straight to the page, with no take-over step", async () => {
    await expect(page.getByRole("button", { name: "Take over" })).toHaveCount(0);
    const canvas = page.getByTestId("browser-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    await expect
      .poll(
        () =>
          canvas.evaluate((el) => {
            const c = el as HTMLCanvasElement;
            const [r, g, b] = c.getContext("2d")?.getImageData(5, c.height - 5, 1, 1).data ?? [];
            return (g ?? 0) > 120 && (r ?? 255) < 100 && (b ?? 255) < 120;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  await test.step("resizing the panel resizes the page", async () => {
    const before = (await sizes()).applied;
    const handle = page.getByRole("separator", { name: "Resize panel" });
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("no resize handle");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 150, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const s = await sizes();
        return s.applied !== before && s.applied === s.panel;
      })
      .toBe(true);
  });

  await test.step("closing the browser returns to the open screen", async () => {
    await page.getByRole("button", { name: "Browser options" }).click();
    await page.getByRole("menuitem", { name: "Close browser" }).click();
    await expect(page.getByTestId("browser-closed")).toBeVisible({ timeout: 15_000 });
  });

  await api(page, "POST", `/sessions/${id}/stop`);
});

test("editing a memory file previews the diff and writes the file", async ({ page }) => {
  const file = join(env("CODEDEN_E2E_USER_HOME"), ".claude", "CLAUDE.md");
  expect(readFileSync(file, "utf8")).toBe(E2E_CLAUDE_MD);
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await page.goto(`${new URL(env("CODEDEN_E2E_URL")).origin}/agents?tab=memory&project=global`);

  await page.locator('[data-config-path=".claude/CLAUDE.md"]').click();
  const editor = page.getByTestId("config-file-editor");
  await expect(editor.locator(".cm-content")).toContainText("Keep answers short.");
  await editor.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("- Added by the e2e test.");

  await editor.getByRole("button", { name: "Review & save" }).click();
  const dialog = page.getByTestId("patch-dialog");
  await expect(dialog.getByTestId("patch-view")).toContainText("+- Added by the e2e test.");
  await expect(dialog).toContainText("+1");
  await dialog.getByRole("button", { name: "Save to file" }).click();
  await expect(page.getByText("Saved CLAUDE.md")).toBeVisible();

  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toBe(`${E2E_CLAUDE_MD}- Added by the e2e test.`);
  // The previous version was backed up first.
  const backups = join(env("CODEDEN_E2E_HOME"), "backups", "agent-config");
  expect(existsSync(backups) && readdirSync(backups, { recursive: true }).length > 0).toBe(true);
});
