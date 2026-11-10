import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BrowserInput } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BrowserCommandHandlers,
  BrowserManager,
  createBrowserCommandHandlers,
  findInstalledChannels,
} from "../src/browser";
import { jpegSize } from "../src/browser/images";
import { isAlive, listDescendants } from "../src/process/tree";
import { StreamRecorder, TestSite } from "./browser-helpers";

const hasBrowser = findInstalledChannels().length > 0;
const execFileAsync = promisify(execFile);

async function eventually<T>(
  check: () => Promise<T> | T,
  timeoutMs = 10_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!hasBrowser)("browser engine (installed Edge/Chrome)", { timeout: 30_000 }, () => {
  let site: TestSite;
  let recorder: StreamRecorder;
  let manager: BrowserManager;
  let browser: BrowserCommandHandlers;

  beforeAll(async () => {
    site = await TestSite.start();
    recorder = new StreamRecorder();
    manager = new BrowserManager({ stream: recorder.push });
    browser = createBrowserCommandHandlers({ manager });
  });
  afterAll(async () => {
    await manager?.shutdown();
    await site?.close();
  });

  it("launches lazily with a loopback CDP endpoint and opens a session tab", async () => {
    expect(manager.cdpUrl).toBeNull();
    const opened = await browser.execute({ name: "browser.open", sessionId: "s1", url: site.url });
    expect(opened).toMatchObject({ cdpUrl: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+\//) });
    expect(["msedge", "chrome"]).toContain(manager.channel);
    expect(manager.pid).toBeGreaterThan(0);
    const tabs = await browser.handlers["browser.tabs.list"]({
      name: "browser.tabs.list",
      sessionId: "s1",
    });
    expect(tabs.tabs).toEqual([
      { tabId: "t1", url: `${site.url}/`, title: "CodeDen browser test", active: true },
    ]);
    // Tab updates are streamed for the panel's tab strip.
    expect(recorder.items.some((i) => i.kind === "browser.tabs" && i.sessionId === "s1")).toBe(
      true,
    );
  });

  it("streams screencast frames while watched and pauses without viewers", async () => {
    // A 2x page (2560x1600 device pixels) with a viewer cap below its CSS size: frames are
    // scaled down, but never below one pixel per CSS pixel (macOS stalls and misreports
    // below that), so they come at 1280x800.
    await manager.setViewport("s1", { width: 1280, height: 800, deviceScaleFactor: 2 });
    const watch = await browser.handlers["browser.screencast"]({
      name: "browser.screencast",
      sessionId: "s1",
      viewerId: "panel-1",
      watching: true,
      maxWidth: 640,
      maxHeight: 400,
    });
    expect(watch.viewers).toBe(1);
    await manager.get("s1").page().evaluate("document.body.style.background = '#f0f0f0'");
    // A screencast frame (the still-frame fallback has no timestamp).
    const frame = await eventually(() =>
      recorder.frames("s1").find((f) => f.metadata?.timestamp !== undefined),
    );
    expect(frame).toMatchObject({ mediaType: "image/jpeg", tabId: "t1", width: 1280, height: 800 });
    expect(await manager.get("s1").page().evaluate("[innerWidth, innerHeight]")).toEqual([
      1280, 800,
    ]);
    expect(frame.metadata).toMatchObject({ deviceWidth: 1280, deviceHeight: 800 });
    const size = jpegSize(Buffer.from(frame.data, "base64"));
    expect(size).toEqual({ width: frame.width, height: frame.height });

    // A change on the page produces more frames (acks keep the stream flowing).
    const before = recorder.frames("s1").length;
    await manager.get("s1").page().evaluate("document.body.style.background = '#203040'");
    await eventually(() => recorder.frames("s1").length > before);

    // The screencast follows the active tab.
    const second = await manager.get("s1").openTab(`${site.url}/page2`);
    await eventually(() => recorder.frames("s1").some((f) => f.tabId === second.tabId));
    await manager.get("s1").closeTab(second.tabId);
    await eventually(() => manager.get("s1").tabId() === "t1");

    const unwatch = await browser.handlers["browser.screencast"]({
      name: "browser.screencast",
      sessionId: "s1",
      viewerId: "panel-1",
      watching: false,
    });
    expect(unwatch.viewers).toBe(0);
    expect(manager.get("s1").screencast.running).toBe(false);
  });

  it("forwards human mouse and keyboard input mapped from the displayed frame size", async () => {
    const page = manager.get("s1").page();
    await page.reload();
    // The panel shows the 1280x800 viewport at 640x400: the button centre (200,150) is (100,75).
    const frame = { frameWidth: 640, frameHeight: 400 };
    const send = (input: BrowserInput) =>
      browser.execute({ name: "browser.input", sessionId: "s1", input });
    await send({ type: "mouse.move", x: 100, y: 75, ...frame });
    await send({ type: "mouse.down", x: 100, y: 75, button: "left", clickCount: 1, ...frame });
    await send({ type: "mouse.up", x: 100, y: 75, button: "left", clickCount: 1, ...frame });
    await eventually(async () => (await page.textContent("#big")) === "clicked by human");

    // Click into the text box (centre 200,315 -> 100,157.5), then type.
    await send({ type: "mouse.down", x: 100, y: 157.5, button: "left", ...frame });
    await send({ type: "mouse.up", x: 100, y: 157.5, button: "left", ...frame });
    await send({ type: "key.down", key: "h", code: "KeyH", text: "h" });
    await send({ type: "key.up", key: "h", code: "KeyH" });
    await send({ type: "text.insert", text: "ello" });
    await send({ type: "key.down", key: "Backspace", code: "Backspace" });
    await send({ type: "key.up", key: "Backspace", code: "Backspace" });
    await eventually(async () => (await page.inputValue("#name")) === "hell");

    await send({ type: "mouse.wheel", x: 10, y: 10, deltaY: 100, ...frame });
  });

  it("manages tabs, history, viewport and dev servers", async () => {
    const s = "tabs";
    await browser.execute({ name: "browser.open", sessionId: s, url: site.url });
    const opened = await browser.handlers["browser.tabs.open"]({
      name: "browser.tabs.open",
      sessionId: s,
      url: `${site.url}/page2`,
    });
    expect(opened.tab).toMatchObject({ tabId: "t2", title: "Second page", active: true });

    await browser.execute({ name: "browser.navigate", sessionId: s, url: `${site.url}/whoami` });
    const back = await browser.handlers["browser.history"]({
      name: "browser.history",
      sessionId: s,
      action: "back",
    });
    expect(back.url).toBe(`${site.url}/page2`);
    const fwd = await browser.handlers["browser.history"]({
      name: "browser.history",
      sessionId: s,
      action: "forward",
    });
    expect(fwd.url).toBe(`${site.url}/whoami`);

    await browser.execute({ name: "browser.tabs.activate", sessionId: s, tabId: "t1" });
    expect(manager.get(s).tabId()).toBe("t1");

    const applied = await browser.execute({
      name: "browser.viewport",
      sessionId: s,
      width: 900,
      height: 600,
    });
    expect(applied).toEqual({ width: 900, height: 600, deviceScaleFactor: 1 });
    expect(await manager.get(s).page("t2").evaluate("[innerWidth, innerHeight]")).toEqual([
      900, 600,
    ]);

    const dev = await browser.handlers["browser.devServer"]({
      name: "browser.devServer",
      sessionId: s,
      port: site.port,
      path: "/page2",
    });
    expect(dev.tab).toMatchObject({ url: `http://localhost:${site.port}/page2`, active: true });

    await browser.execute({ name: "browser.tabs.close", sessionId: s, tabId: dev.tab.tabId });
    await eventually(() => manager.get(s).listTabs().length === 2);
    await expect(
      browser.execute({ name: "browser.navigate", sessionId: s, url: "edge://settings" }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await browser.execute({ name: "browser.close", sessionId: s });
    expect(manager.has(s)).toBe(false);
  });

  it("follows the panel size: viewport, scale, frames, input, new tabs and screenshots", async () => {
    const s = "sized";
    await browser.execute({ name: "browser.open", sessionId: s, url: site.url });
    const session = manager.get(s);
    await browser.execute({
      name: "browser.screencast",
      sessionId: s,
      viewerId: "panel",
      watching: true,
    });
    const frameAt = (width: number, height: number) =>
      eventually(() => recorder.frames(s).find((f) => f.width === width && f.height === height));

    // A 460x712 panel on a 2x screen: the page lays out at 460 CSS px, frames are 920x1424.
    const hidpi = await browser.execute({
      name: "browser.viewport",
      sessionId: s,
      width: 460,
      height: 712,
      deviceScaleFactor: 2,
    });
    expect(hidpi).toEqual({ width: 460, height: 712, deviceScaleFactor: 2 });
    const page = session.page();
    expect(await page.evaluate("[innerWidth, innerHeight, devicePixelRatio]")).toEqual([
      460, 712, 2,
    ]);
    const frame = await frameAt(920, 1424);
    expect(frame.metadata).toMatchObject({ deviceWidth: 460, deviceHeight: 712 });

    // Input in frame pixels maps onto CSS pixels: the button centre (200,150) is (400,300).
    await page.reload();
    const send = (input: BrowserInput) =>
      browser.execute({ name: "browser.input", sessionId: s, input });
    const at = { x: 400, y: 300, frameWidth: 920, frameHeight: 1424 };
    await send({ type: "mouse.down", ...at, viewportWidth: 460, viewportHeight: 712 });
    await send({ type: "mouse.up", ...at, viewportWidth: 460, viewportHeight: 712 });
    await eventually(async () => (await page.textContent("#big")) === "clicked by human");

    // Resize again (wider, 1.25x): frames follow, and new tabs open at the current size.
    await browser.execute({
      name: "browser.viewport",
      sessionId: s,
      width: 1000,
      height: 640,
      deviceScaleFactor: 1.25,
    });
    await frameAt(1250, 800);
    const tab = await session.openTab(`${site.url}/page2`);
    expect(await session.page(tab.tabId).evaluate("[innerWidth, devicePixelRatio]")).toEqual([
      1000, 1.25,
    ]);
    // Popups too.
    const [popup] = await Promise.all([
      session.context.waitForEvent("page"),
      session.page(tab.tabId).evaluate(`window.open(${JSON.stringify(`${site.url}/page2`)})`),
    ]);
    await eventually(async () => (await popup.evaluate("innerWidth")) === 1000);

    // Agent screenshots use the current viewport, in CSS pixels.
    const shot = await browser.handlers["browser.screenshot"]({
      name: "browser.screenshot",
      sessionId: s,
      path: join(tmpdir(), `codeden-shot-${Date.now()}.png`),
    });
    expect(shot).toMatchObject({ width: 1000, height: 640 });

    // Clamped: a tiny panel still lays out at 320x240.
    expect(
      await browser.execute({ name: "browser.viewport", sessionId: s, width: 100, height: 80 }),
    ).toEqual({ width: 320, height: 240, deviceScaleFactor: 1 });

    // A reopened browser keeps the last size.
    await browser.execute({ name: "browser.close", sessionId: s });
    await browser.execute({ name: "browser.open", sessionId: s, url: site.url });
    expect(await manager.get(s).page().evaluate("innerWidth")).toBe(320);
    await browser.execute({ name: "browser.close", sessionId: s });
  });

  it("still pages get a frame at the final size after a burst of resizes", async () => {
    const s = "burst";
    await browser.execute({ name: "browser.open", sessionId: s, url: `${site.url}/page2` });
    await browser.execute({
      name: "browser.screencast",
      sessionId: s,
      viewerId: "panel",
      watching: true,
    });
    for (let round = 0; round < 5; round++) {
      const width = 500 + round * 37;
      // Fire-and-forget resizes while frames are still unacked, like a panel being dragged.
      await Promise.all(
        [width - 30, width - 20, width - 10, width].map((w, i) =>
          new Promise((r) => setTimeout(r, i * 15)).then(() =>
            browser.execute({
              name: "browser.viewport",
              sessionId: s,
              width: w,
              height: 600,
              deviceScaleFactor: 2,
            }),
          ),
        ),
      );
      await eventually(
        () => recorder.frames(s).some((f) => f.width === width * 2 && f.height === 1200),
        5_000,
      );
    }
    await browser.execute({ name: "browser.close", sessionId: s });
  });

  it("isolates sessions in separate contexts (cookies do not leak)", async () => {
    await manager.open("alice", `${site.url}/set?v=alice`);
    await manager.open("bob", `${site.url}/whoami`);
    const bobPage = manager.get("bob").page();
    expect(await bobPage.textContent("#c")).toBe("none");
    await manager.get("alice").navigate(`${site.url}/whoami`);
    expect(await manager.get("alice").page().textContent("#c")).toBe("who=alice");
    await bobPage.reload();
    expect(await bobPage.textContent("#c")).toBe("none");
    expect(await manager.get("bob").context.cookies()).toEqual([]);
  });
});

/**
 * Pids from `pids` that still belong to the processes seen at `seenAt`. Windows reuses pids
 * quickly, so a live pid only counts when its process was created before `seenAt`.
 */
async function survivors(pids: number[], seenAt: number): Promise<number[]> {
  const alive = pids.filter(isAlive);
  if (process.platform !== "win32" || alive.length === 0) return alive;
  const script =
    `Get-CimInstance Win32_Process | Where-Object { @(${alive.join(",")}) -contains $_.ProcessId } | ` +
    'ForEach-Object { "$($_.ProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }';
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(" ").map(Number))
    .filter(([p, created]) => p !== undefined && created !== undefined && created <= seenAt)
    .map(([p]) => p as number);
}

describe.skipIf(!hasBrowser)("browser shutdown", { timeout: 30_000 }, () => {
  it("closes the browser and kills its whole process tree", async () => {
    const manager = new BrowserManager({ stream: () => {} });
    await manager.open("s", "about:blank");
    const pid = manager.pid as number;
    expect(isAlive(pid)).toBe(true);
    const children = await listDescendants(pid);
    const seenAt = Date.now();
    expect(children.length).toBeGreaterThan(0);
    await manager.shutdown();
    await eventually(
      async () => (await survivors([pid, ...children], seenAt)).length === 0,
      15_000,
    );
    expect(manager.cdpUrl).toBeNull();
    await expect(manager.open("s")).rejects.toMatchObject({ code: "unavailable" });
  });
});
