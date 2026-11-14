# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: updates.spec.ts >> the update banner drives the desktop updater
- Location: e2e\updates.spec.ts:80:1

# Error details

```
Error: EPERM, Permission denied: 'C:\Users\friso\AppData\Local\Temp\codeden-e2e-desktop-update-AsBp4i'
```

# Test source

```ts
  1   | import { createHash, randomBytes } from "node:crypto";
  2   | import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
  3   | import { createServer, type Server } from "node:http";
  4   | import type { AddressInfo } from "node:net";
  5   | import { tmpdir } from "node:os";
  6   | import { join } from "node:path";
  7   | import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
  8   | import { sweepProcesses } from "../../web/e2e/support/process-sweep";
  9   | import { unpackedApp } from "./support";
  10  | 
  11  | /**
  12  |  * Desktop updates (§17) against a local feed: the server's update policy asks the app's
  13  |  * updater (electron-updater) to check, the update banner offers the release, and a download
  14  |  * is verified against the feed's sha512 and waits for a restart. Nothing is installed: the
  15  |  * test ends before the installer would run. Windows only (the unpacked Linux build has no
  16  |  * AppImage to update and unsigned macOS builds don't update).
  17  |  */
  18  | test.skip(process.platform !== "win32", "the update feed test runs on Windows");
  19  | 
  20  | const NEXT = "99.0.0";
  21  | let base: string;
  22  | let home: string;
  23  | let feed: Server;
  24  | let feedUrl: string;
  25  | let app: ElectronApplication | undefined;
  26  | /** The app uses a separate download cache when it reads a test feed. */
  27  | const updaterCache = join(process.env.LOCALAPPDATA ?? tmpdir(), "codeden-updater-test");
  28  | 
  29  | test.beforeAll(async () => {
  30  |   base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-e2e-desktop-update-")));
  31  |   home = join(base, "home");
  32  |   const installer = randomBytes(256 * 1024);
  33  |   const sha512 = createHash("sha512").update(installer).digest("base64");
  34  |   const file = `CodeDen-Setup-${NEXT}.exe`;
  35  |   const latest = [
  36  |     `version: ${NEXT}`,
  37  |     "files:",
  38  |     `  - url: ${file}`,
  39  |     `    sha512: ${sha512}`,
  40  |     `    size: ${installer.length}`,
  41  |     `path: ${file}`,
  42  |     `sha512: ${sha512}`,
  43  |     `releaseDate: '2026-11-08T00:00:00.000Z'`,
  44  |     "",
  45  |   ].join("\n");
  46  |   feed = createServer((req, res) => {
  47  |     const url = req.url ?? "/";
  48  |     if (url.startsWith("/latest.yml")) {
  49  |       res.writeHead(200, { "content-type": "text/yaml" });
  50  |       res.end(latest);
  51  |     } else if (url === `/${file}`) {
  52  |       res.writeHead(200, { "content-type": "application/octet-stream" });
  53  |       res.end(installer);
  54  |     } else if (url.startsWith("/notes/")) {
  55  |       res.writeHead(200, { "content-type": "application/json" });
  56  |       res.end(
  57  |         JSON.stringify({ body: "### Desktop\n\n- Updates from GitHub Releases.", html_url: "" }),
  58  |       );
  59  |     } else {
  60  |       res.writeHead(404);
  61  |       res.end();
  62  |     }
  63  |   });
  64  |   await new Promise<void>((done) => feed.listen(0, "127.0.0.1", done));
  65  |   feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}`;
  66  | });
  67  | 
  68  | test.afterAll(async () => {
  69  |   // Kill rather than quit: quitting with a downloaded update would run the (fake) installer.
  70  |   app?.process().kill();
  71  |   await sweepProcesses(home, 15_000);
  72  |   await new Promise<void>((done) => {
  73  |     feed.closeAllConnections();
  74  |     feed.close(() => done());
  75  |   });
  76  |   rmSync(updaterCache, { recursive: true, force: true });
> 77  |   rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      |   ^ Error: EPERM, Permission denied: 'C:\Users\friso\AppData\Local\Temp\codeden-e2e-desktop-update-AsBp4i'
  78  | });
  79  | 
  80  | test("the update banner drives the desktop updater", async () => {
  81  |   const env = {
  82  |     ...process.env,
  83  |     CODEDEN_HOME: "",
  84  |     CODEDEN_DESKTOP_TEST: "1",
  85  |     CODEDEN_UPDATE_CHECK: "1",
  86  |     CODEDEN_DESKTOP_UPDATE_URL: feedUrl,
  87  |     CODEDEN_RELEASE_NOTES_URL: `${feedUrl}/notes/v{version}`,
  88  |     CODEDEN_GITHUB_SYNC: "0",
  89  |     CODEDEN_BUILTIN_PROVIDERS: "0",
  90  |   };
  91  |   app = await _electron.launch({
  92  |     executablePath: unpackedApp(),
  93  |     args: ["--home", home, "--port", "0", "--fake"],
  94  |     env,
  95  |   });
  96  |   const page = await app.firstWindow();
  97  |   await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/setup$/, { timeout: 90_000 });
  98  |   const origin = new URL(page.url()).origin;
  99  |   const token = readFileSync(join(home, "install-token"), "utf8").trim();
  100 |   const api = (path: string, body?: unknown) =>
  101 |     fetch(`${origin}${path}`, {
  102 |       method: body === undefined ? "GET" : "POST",
  103 |       headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  104 |       body: body === undefined ? undefined : JSON.stringify(body),
  105 |     });
  106 |   expect((await api("/api/setup/complete", {})).ok).toBe(true);
  107 |   await page.goto(`${origin}/`);
  108 |   const banner = page.getByTestId("update-banner");
  109 | 
  110 |   await test.step("the release is offered on launch", async () => {
  111 |     await expect(banner).toHaveAttribute("data-state", "available");
  112 |     await expect(banner).toContainText(`CodeDen ${NEXT} is available.`);
  113 |     await expect(banner.getByRole("button", { name: "Update now" })).toBeVisible();
  114 |     const status = await (await api("/api/updates")).json();
  115 |     expect(status).toMatchObject({ source: "desktop", latest: NEXT, canRollback: false });
  116 |     const shots = process.env.CODEDEN_DESKTOP_SCREENSHOTS;
  117 |     if (shots) {
  118 |       mkdirSync(shots, { recursive: true });
  119 |       await page.screenshot({ path: join(shots, "desktop-update-banner.png") });
  120 |     }
  121 |   });
  122 | 
  123 |   await test.step("What's new shows the release notes", async () => {
  124 |     await banner.getByRole("button", { name: "What's new" }).click();
  125 |     await expect(page.getByTestId("whats-new")).toContainText("Updates from GitHub Releases.");
  126 |     await page.keyboard.press("Escape");
  127 |   });
  128 | 
  129 |   await test.step("a download is verified and waits for a restart", async () => {
  130 |     expect((await api("/api/updates/install", { restart: false })).ok).toBe(true);
  131 |     await expect(banner).toHaveAttribute("data-state", "installed", { timeout: 60_000 });
  132 |     await expect(banner.getByRole("button", { name: "Restart now" })).toBeVisible();
  133 |     await expect
  134 |       .poll(() =>
  135 |         (app as ElectronApplication).evaluate(() =>
  136 |           (
  137 |             globalThis as unknown as { __codedenDesktopTest: { trayLabels(): string[] } }
  138 |           ).__codedenDesktopTest.trayLabels(),
  139 |         ),
  140 |       )
  141 |       .toContain(`Restart to update to ${NEXT}`);
  142 |   });
  143 | });
  144 | 
```