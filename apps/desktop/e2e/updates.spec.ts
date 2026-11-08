import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import { sweepProcesses } from "../../web/e2e/support/process-sweep";
import { unpackedApp } from "./support";

/**
 * Desktop updates (§17) against a local feed: the server's update policy asks the app's
 * updater (electron-updater) to check, the update banner offers the release, and a download
 * is verified against the feed's sha512 and waits for a restart. Nothing is installed: the
 * test ends before the installer would run. Windows only (the unpacked Linux build has no
 * AppImage to update and unsigned macOS builds don't update).
 */
test.skip(process.platform !== "win32", "the update feed test runs on Windows");

const NEXT = "99.0.0";
let base: string;
let home: string;
let feed: Server;
let feedUrl: string;
let app: ElectronApplication | undefined;
/** The app uses a separate download cache when it reads a test feed. */
const updaterCache = join(process.env.LOCALAPPDATA ?? tmpdir(), "codeden-updater-test");

test.beforeAll(async () => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-e2e-desktop-update-")));
  home = join(base, "home");
  const installer = randomBytes(256 * 1024);
  const sha512 = createHash("sha512").update(installer).digest("base64");
  const file = `CodeDen-Setup-${NEXT}.exe`;
  const latest = [
    `version: ${NEXT}`,
    "files:",
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '2026-11-08T00:00:00.000Z'`,
    "",
  ].join("\n");
  feed = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/latest.yml")) {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(latest);
    } else if (url === `/${file}`) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(installer);
    } else if (url.startsWith("/notes/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ body: "### Desktop\n\n- Updates from GitHub Releases.", html_url: "" }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((done) => feed.listen(0, "127.0.0.1", done));
  feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  // Kill rather than quit: quitting with a downloaded update would run the (fake) installer.
  app?.process().kill();
  await sweepProcesses(home, 15_000);
  await new Promise<void>((done) => {
    feed.closeAllConnections();
    feed.close(() => done());
  });
  rmSync(updaterCache, { recursive: true, force: true });
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("the update banner drives the desktop updater", async () => {
  const env = {
    ...process.env,
    CODEDEN_HOME: "",
    CODEDEN_DESKTOP_TEST: "1",
    CODEDEN_UPDATE_CHECK: "1",
    CODEDEN_DESKTOP_UPDATE_URL: feedUrl,
    CODEDEN_RELEASE_NOTES_URL: `${feedUrl}/notes/v{version}`,
    CODEDEN_GITHUB_SYNC: "0",
    CODEDEN_BUILTIN_PROVIDERS: "0",
  };
  app = await _electron.launch({
    executablePath: unpackedApp(),
    args: ["--home", home, "--port", "0", "--fake"],
    env,
  });
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/setup$/, { timeout: 90_000 });
  const origin = new URL(page.url()).origin;
  const token = readFileSync(join(home, "install-token"), "utf8").trim();
  const api = (path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  expect((await api("/api/setup/complete", {})).ok).toBe(true);
  await page.goto(`${origin}/`);
  const banner = page.getByTestId("update-banner");

  await test.step("the release is offered on launch", async () => {
    await expect(banner).toHaveAttribute("data-state", "available");
    await expect(banner).toContainText(`CodeDen ${NEXT} is available.`);
    await expect(banner.getByRole("button", { name: "Update now" })).toBeVisible();
    const status = await (await api("/api/updates")).json();
    expect(status).toMatchObject({ source: "desktop", latest: NEXT, canRollback: false });
    const shots = process.env.CODEDEN_DESKTOP_SCREENSHOTS;
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "desktop-update-banner.png") });
    }
  });

  await test.step("What's new shows the release notes", async () => {
    await banner.getByRole("button", { name: "What's new" }).click();
    await expect(page.getByTestId("whats-new")).toContainText("Updates from GitHub Releases.");
    await page.keyboard.press("Escape");
  });

  await test.step("a download is verified and waits for a restart", async () => {
    expect((await api("/api/updates/install", { restart: false })).ok).toBe(true);
    await expect(banner).toHaveAttribute("data-state", "installed", { timeout: 60_000 });
    await expect(banner.getByRole("button", { name: "Restart now" })).toBeVisible();
    await expect
      .poll(() =>
        (app as ElectronApplication).evaluate(() =>
          (
            globalThis as unknown as { __codedenDesktopTest: { trayLabels(): string[] } }
          ).__codedenDesktopTest.trayLabels(),
        ),
      )
      .toContain(`Restart to update to ${NEXT}`);
  });
});
