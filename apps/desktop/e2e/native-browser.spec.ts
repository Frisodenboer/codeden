import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import { processesMentioning, sweepProcesses } from "../../web/e2e/support/process-sweep";
import { appLaunch, makeRepo, runnerCommand } from "./support";

/**
 * Native browser views (§17 Phase 2) in the real app: opening the browser panel shows a native
 * view at the panel's bounds and keeps it there through a resize; agent commands (sent to the
 * runner as the agent tools do) navigate, snapshot and click in it; two sessions keep their
 * cookies apart; a menu over the view hides it; quitting hands the open sessions to the
 * runner's own Chromium with their URLs and cookies.
 */
type ViewState = {
  sessionId: string;
  url: string;
  active: boolean;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
};
type Hooks = {
  nativeViews(): ViewState[];
  zoomFactor(): number;
  windowShot(): Promise<string | null>;
};
type HookFns = Record<string, () => unknown>;
const hook = <K extends keyof Hooks>(app: ElectronApplication, name: K) =>
  app.evaluate(
    (_e, n: string) =>
      (globalThis as unknown as { __codedenDesktopTest: HookFns }).__codedenDesktopTest[n]?.(),
    name as string,
  ) as Promise<Awaited<ReturnType<Hooks[K]>>>;

const PAGE = `<!doctype html><title>Native fixture</title>
<body style="margin:0;font:18px system-ui">
<h1 style="margin:24px">Native browser view</h1>
<button style="margin:24px;font-size:20px" onclick="document.title='clicked'">Press me</button>
<p id="c" style="margin:24px"></p>
<script>document.getElementById('c').textContent = document.cookie || 'no cookie'</script>
${Array.from({ length: 60 }, (_, i) => `<p style="margin:24px">Line ${i + 1}: scroll me natively.</p>`).join("")}
</body>`;

const shots = process.env.CODEDEN_DESKTOP_SCREENSHOTS;
async function shot(app: ElectronApplication, name: string) {
  if (!shots) return;
  const png = await hook(app, "windowShot");
  if (!png) return;
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, `native-${name}.png`), Buffer.from(png, "base64"));
}

let base: string;
let home: string;
let site: Server;
let siteUrl: string;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-e2e-native-")));
  home = join(base, "home");
  mkdirSync(join(base, "repo"));
  makeRepo(join(base, "repo"));
  site = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/set")
      res.setHeader("set-cookie", `who=${url.searchParams.get("v")}; Path=/`);
    res.end(PAGE);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
});

test.afterAll(async () => {
  if (app) {
    const proc = app.process();
    const closed = app.close().then(
      () => true,
      () => false,
    );
    const done = await Promise.race([
      closed,
      new Promise((r) => setTimeout(() => r(false), 15_000)),
    ]);
    if (!done && proc.pid && proc.exitCode === null) proc.kill();
  }
  await sweepProcesses(home, 15_000);
  site?.closeAllConnections();
  site?.close();
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("native browser views: placement, agents, isolation, overlays and the quit hand-off", async () => {
  const env = {
    ...process.env,
    CODEDEN_HOME: "",
    CODEDEN_DESKTOP_TEST: "1",
    CODEDEN_UPDATE_CHECK: "0",
    CODEDEN_GITHUB_SYNC: "0",
    CODEDEN_BUILTIN_PROVIDERS: "0",
  };
  const args = ["--home", home, "--port", "0", "--fake"];
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await _electron.launch({ ...appLaunch(args), env });
  const electronApp = app;
  const page = await electronApp.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/setup$/, { timeout: 90_000 });
  const origin = new URL(page.url()).origin;
  const token = readFileSync(join(home, "install-token"), "utf8").trim();
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.ok, `${method} ${path}: ${res.status}`).toBe(true);
    return (await res.json()) as T;
  };
  await api("POST", "/setup/complete", {});
  const { project } = await api<{ project: { id: string } }>("POST", "/projects", {
    source: { type: "local", path: join(base, "repo") },
  });
  const start = async (name: string) =>
    (
      await api<{ sessionId: string }>("POST", "/sessions", {
        projectId: project.id,
        provider: "fake",
        purpose: name,
        workKey: `task:native-${name}`,
      })
    ).sessionId;
  const one = await start("one");
  const two = await start("two");
  const views = () => hook(electronApp, "nativeViews");
  const shown = async (sessionId: string) =>
    (await views()).find((v) => v.sessionId === sessionId && v.visible) ?? null;

  /** The native view sits exactly over the panel's host box (zoom 100%, ±1 px for rounding). */
  const expectOverPanel = async (sessionId: string) => {
    await expect
      .poll(async () => {
        const box = await page.getByTestId("native-browser-view").boundingBox();
        const view = await shown(sessionId);
        if (!box || !view?.bounds) return "not shown";
        const off = Math.max(
          Math.abs(view.bounds.x - box.x),
          Math.abs(view.bounds.y - box.y),
          Math.abs(view.bounds.width - box.width),
          Math.abs(view.bounds.height - box.height),
        );
        return off <= 1 ? "aligned" : `off by ${off}`;
      })
      .toBe("aligned");
  };

  const openPanel = async (sessionId: string) => {
    await page.goto(`${origin}/sessions/${sessionId}`);
    await expect(page.getByText("No messages yet")).toBeVisible();
    if (!(await page.getByTestId("browser-closed").isVisible())) await page.keyboard.press("Alt+3");
    await page.getByRole("button", { name: "Open browser" }).click();
    await expect(page.getByTestId("native-browser-view")).toBeVisible();
    await expect(page.getByTestId("browser-viewport")).toHaveAttribute("data-engine", "native");
  };

  await test.step("opening the browser panel shows a native view at the panel's bounds", async () => {
    await openPanel(one);
    await expectOverPanel(one);
    // The desktop window drew no screencast for it.
    await expect(page.getByTestId("browser-canvas")).toHaveCount(0);
  });

  await test.step("the address bar navigates the native view", async () => {
    await page.getByLabel("Address").fill(siteUrl);
    await page.getByLabel("Address").press("Enter");
    await expect.poll(async () => (await shown(one))?.url).toBe(siteUrl);
    await shot(electronApp, "panel");
  });

  await test.step("a resize keeps the view on the panel", async () => {
    const before = (await shown(one))?.bounds;
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.unmaximize();
      win.setSize(1200, 820);
    });
    await expect.poll(async () => (await shown(one))?.bounds?.height).not.toBe(before?.height);
    await expectOverPanel(one);
    // Collapsing the sidebar moves and widens the panel: the view follows.
    await page.keyboard.press("Control+b");
    await expectOverPanel(one);
    await page.keyboard.press("Control+b");
    await expectOverPanel(one);
  });

  await test.step("agent commands navigate, snapshot and click in the native view", async () => {
    await runnerCommand(home, {
      name: "browser.navigate",
      sessionId: one,
      url: `${siteUrl}set?v=one`,
    });
    await expect.poll(async () => (await shown(one))?.url).toBe(`${siteUrl}set?v=one`);
    const snap = await runnerCommand<{ snapshot: string }>(home, {
      name: "browser.snapshot",
      sessionId: one,
    });
    const ref = /button "Press me" \[ref=((?:f\d+)?e\d+)\]/.exec(snap.snapshot)?.[1];
    expect(ref, snap.snapshot.slice(0, 600)).toBeTruthy();
    await runnerCommand(home, { name: "browser.click", sessionId: one, ref: ref as string });
    const title = await runnerCommand<{ json: string }>(home, {
      name: "browser.evaluate",
      sessionId: one,
      expression: "document.title",
    });
    expect(title.json).toBe('"clicked"');
    const tabs = await runnerCommand<{ engine: string }>(home, {
      name: "browser.tabs.list",
      sessionId: one,
    });
    expect(tabs.engine).toBe("native");
  });

  await test.step("two sessions keep their cookies apart", async () => {
    await openPanel(two);
    await expectOverPanel(two);
    expect(await shown(one)).toBeNull();
    await runnerCommand(home, { name: "browser.navigate", sessionId: two, url: siteUrl });
    const cookie = (sessionId: string) =>
      runnerCommand<{ json: string }>(home, {
        name: "browser.evaluate",
        sessionId,
        expression: "document.cookie",
      }).then((r) => r.json);
    expect(await cookie(one)).toBe('"who=one"');
    expect(await cookie(two)).toBe('""');
  });

  await test.step("a menu over the view hides it, and it comes back", async () => {
    await page.getByRole("button", { name: "Browser options" }).click();
    await expect(page.getByRole("menuitem", { name: "Inspect" })).toBeVisible();
    await expect.poll(() => shown(two)).toBeNull();
    await shot(electronApp, "menu-over-view");
    await page.keyboard.press("Escape");
    await expectOverPanel(two);
  });

  await test.step("quitting hands the open sessions to the runner's Chromium", async () => {
    const runnerPid = JSON.parse(readFileSync(join(home, "runner", "runner.json"), "utf8")).pid;
    const exited = new Promise((done) => electronApp.process().once("exit", done));
    await electronApp.evaluate(({ app: a }) => a.quit());
    await exited;
    app = undefined;
    expect(processesMentioning(home).some((p) => p.pid === runnerPid)).toBe(true);
    const tabs = await runnerCommand<{ engine: string; tabs: { url: string }[] }>(home, {
      name: "browser.tabs.list",
      sessionId: one,
    });
    expect(tabs).toMatchObject({ engine: "runner", tabs: [{ url: `${siteUrl}set?v=one` }] });
    const cookie = await runnerCommand<{ json: string }>(home, {
      name: "browser.evaluate",
      sessionId: one,
      expression: "document.cookie",
    });
    expect(cookie.json).toBe('"who=one"');
    const other = await runnerCommand<{ engine: string }>(home, {
      name: "browser.tabs.list",
      sessionId: two,
    });
    expect(other.engine).toBe("runner");
  });
});
