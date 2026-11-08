import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { processesMentioning, sweepProcesses } from "../../web/e2e/support/process-sweep";
import { unpackedApp } from "./support";

/**
 * Desktop smoke test (§17): the unpacked app for this OS (`pnpm desktop:build`) starts its
 * own server and runner in an isolated home with the Fake provider, loads the UI through the
 * token bootstrap, exposes the preload bridge and the tray, zooms and remembers the zoom
 * (View menu), follows `codeden://` links from a
 * second launch, hides to the tray on close, and quits leaving the runner running (which the
 * test then stops, so nothing outlives it).
 */
type TestHooks = {
  trayLabels(): string[];
  status(): { connected: boolean; activity: unknown };
  ownsServer(): boolean;
  keepAwake(): boolean;
  zoomFactor(): number;
};

/** Call one of the read-only hooks the app exposes with `CODEDEN_DESKTOP_TEST=1`. */
const hook = <K extends keyof TestHooks>(app: ElectronApplication, name: K) =>
  app.evaluate(
    (_electron, n) =>
      (globalThis as unknown as { __codedenDesktopTest: TestHooks }).__codedenDesktopTest[n](),
    name,
  ) as Promise<ReturnType<TestHooks[K]>>;

const shots = process.env.CODEDEN_DESKTOP_SCREENSHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `desktop-${name}.png`) });
}

let base: string;
let home: string;
let app: ElectronApplication | undefined;

test.beforeAll(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-e2e-desktop-")));
  home = join(base, "home");
});

test.afterAll(async () => {
  if (app) {
    // A failed step can leave the app hidden in the tray; don't let close() hang, and never
    // leave CodeDen.exe running (it locks the next build's output folder on Windows).
    const proc = app.process();
    const closed = app.close().then(
      () => true,
      () => false,
    );
    const done = await Promise.race([
      closed,
      new Promise<boolean>((r) => setTimeout(() => r(false), 15_000)),
    ]);
    if (!done && proc.pid && proc.exitCode === null) proc.kill();
  }
  const left = await sweepProcesses(home, 15_000);
  if (left.length) console.warn(`desktop e2e: stopped ${left.length} leftover process(es)`);
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("the desktop app starts, bridges, tracks, follows links and quits cleanly", async () => {
  const exe = unpackedApp();
  const env = {
    ...process.env,
    CODEDEN_HOME: "",
    CODEDEN_DESKTOP_TEST: "1",
    CODEDEN_UPDATE_CHECK: "0",
    CODEDEN_GITHUB_SYNC: "0",
    CODEDEN_BUILTIN_PROVIDERS: "0",
  };
  const launchArgs = ["--home", home, "--port", "0", "--fake"];
  if (process.platform === "linux") launchArgs.push("--no-sandbox");
  app = await _electron.launch({ executablePath: exe, args: launchArgs, env });
  const page = await app.firstWindow();
  const token = () => readFileSync(join(home, "install-token"), "utf8").trim();

  await test.step("loads the UI from its own server, authenticated by the launch URL", async () => {
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/setup$/, { timeout: 90_000 });
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
    await expect(page.getByText("built into the app")).toBeVisible({ timeout: 60_000 });
    expect(await hook(app as ElectronApplication, "ownsServer")).toBe(true);
    await shot(page, "setup");
  });
  const origin = new URL(page.url()).origin;
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    });

  await test.step("exposes only the typed bridge to the page", async () => {
    const shape = await page.evaluate(() => ({
      bridge: Object.keys((window as unknown as { codedenDesktop: object }).codedenDesktop).sort(),
      node: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(shape).toEqual({
      bridge: [
        "info",
        "notify",
        "onNavigate",
        "onNotificationClick",
        "openExternal",
        "pickFolder",
        "setBadge",
      ],
      node: "undefined",
      process: "undefined",
    });
    const info = await page.evaluate(() =>
      (
        window as unknown as { codedenDesktop: { info(): Promise<Record<string, unknown>> } }
      ).codedenDesktop.info(),
    );
    expect(info).toMatchObject({ packaged: true, ownsServer: true });
  });

  await test.step("the tray reads live counts from the server", async () => {
    await expect
      .poll(() => hook(app as ElectronApplication, "trayLabels"), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(["No agents running", "Open CodeDen", "Quit CodeDen"]));
    expect(await (await api("/api/activity")).json()).toEqual({ running: 0, waiting: 0, inbox: 0 });
    expect(await hook(app as ElectronApplication, "keepAwake")).toBe(false);
  });

  await test.step("View menu zoom scales the UI, survives a reload and is saved", async () => {
    const electronApp = app as ElectronApplication;
    // Synthetic key presses never reach native menu accelerators, so run the items the keys
    // are bound to (which keys map to which item is covered by the unit tests).
    const zoomBy = (accelerator: string) =>
      electronApp.evaluate(({ Menu }, acc) => {
        const view = Menu.getApplicationMenu()?.items.find((i) => i.label === "View");
        const item = view?.submenu?.items.find((i) => i.accelerator === acc);
        if (!item) throw new Error(`no View menu item for ${acc}`);
        item.click();
      }, accelerator);
    const pageZoom = () =>
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
      );
    const savedZoom = () => {
      try {
        return JSON.parse(readFileSync(join(home, "desktop", "window-state.json"), "utf8"))
          .zoomFactor as number;
      } catch {
        return null;
      }
    };
    expect(await pageZoom()).toBe(1);
    await zoomBy("CommandOrControl+=");
    await zoomBy("CommandOrControl+Plus");
    await zoomBy("CommandOrControl+numadd");
    await zoomBy("CommandOrControl+-");
    expect(await pageZoom()).toBe(1.2);
    expect(await hook(electronApp, "zoomFactor")).toBe(1.2);
    await page.reload();
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
    expect(await pageZoom()).toBe(1.2);
    await expect.poll(savedZoom).toBe(1.2);
    await shot(page, "zoom-120");
    await zoomBy("CommandOrControl+0");
    expect(await pageZoom()).toBe(1);
    await expect.poll(savedZoom).toBe(1);
  });

  await test.step("Settings has the App section and projects use the native picker", async () => {
    expect((await api("/api/setup/complete", { method: "POST", body: "{}" })).ok).toBe(true);
    await page.goto(`${origin}/settings/desktop`);
    await expect(page.getByText("Open at login")).toBeVisible();
    await expect(page.getByText("Keep running in the tray")).toBeVisible();
    await shot(page, "settings-app");
    await page.goto(`${origin}/`);
    // Open the palette from its button: under a virtual display (Linux CI) the window may not
    // have keyboard focus, and the shortcut itself is covered by the web tests.
    await page.getByRole("button", { name: /Search or run/ }).click();
    await page.getByText("Add project…").click();
    await expect(page.getByTestId("native-folder-field")).toBeVisible();
    await expect(page.getByRole("button", { name: /Choose folder/ })).toBeVisible();
    if (shots) await page.waitForTimeout(500); // let the palette finish fading out
    await shot(page, "add-project");
    await page.keyboard.press("Escape");
  });

  await test.step("a codeden:// link from a second launch opens in this window", async () => {
    // Linux CI has no setuid sandbox helper, so every launch needs --no-sandbox, not just the first.
    const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
    const second = spawnSync(exe, ["--home", home, ...extra, "codeden://inbox"], {
      env,
      timeout: 60_000,
    });
    expect(second.error ?? null).toBeNull();
    expect(second.status).toBe(0);
    await expect(page).toHaveURL(`${origin}/inbox`);
  });

  await test.step("closing the window keeps CodeDen in the tray", async () => {
    await (app as ElectronApplication).evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.close(),
    );
    await expect
      .poll(() =>
        (app as ElectronApplication).evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.isVisible()),
        ),
      )
      .toEqual([false]);
    expect((await api("/api/health")).ok).toBe(true);
  });

  await test.step("Quit stops the server and leaves the runner running", async () => {
    const runnerPid = JSON.parse(readFileSync(join(home, "runner", "runner.json"), "utf8")).pid;
    const exited = new Promise((done) => (app as ElectronApplication).process().once("exit", done));
    await (app as ElectronApplication).evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    app = undefined;
    await expect
      .poll(() =>
        api("/api/health").then(
          (r) => r.ok,
          () => false,
        ),
      )
      .toBe(false);
    const runnerAlive = processesMentioning(home).some((p) => p.pid === runnerPid);
    expect(runnerAlive).toBe(true);
    // Now stop it, as `codeden stop` would, and make sure nothing is left.
    await sweepProcesses(home, 0);
    expect(processesMentioning(home)).toEqual([]);
  });
});
