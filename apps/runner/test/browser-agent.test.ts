import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BrowserCommandHandlers,
  BrowserManager,
  createBrowserCommandHandlers,
  findInstalledChannels,
} from "../src/browser";
import { pngSize } from "../src/browser/images";
import { TestSite } from "./browser-helpers";
import { removeDir, tempDir } from "./helpers";

const hasBrowser = findInstalledChannels().length > 0;

function refOf(snapshot: string, pattern: RegExp): string {
  const line = snapshot.split("\n").find((l) => pattern.test(l));
  const ref = line && /\[ref=([a-z0-9]+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`No ref for ${pattern} in:\n${snapshot}`);
  return ref;
}

describe.skipIf(!hasBrowser)("browser agent primitives", { timeout: 30_000 }, () => {
  let site: TestSite;
  let manager: BrowserManager;
  let browser: BrowserCommandHandlers;
  let dir: string;
  const sessionId = "agent";

  beforeAll(async () => {
    site = await TestSite.start();
    dir = tempDir("codeden-browser-");
    manager = new BrowserManager({ stream: () => {}, evaluate: { timeoutMs: 500 } });
    browser = createBrowserCommandHandlers({ manager });
    await browser.execute({ name: "browser.open", sessionId, url: site.url });
  });
  afterAll(async () => {
    await manager?.shutdown();
    await site?.close();
    if (dir) removeDir(dir);
  });

  it("snapshots with element refs, then types and clicks by ref", async () => {
    const snap = await browser.handlers["browser.snapshot"]({
      name: "browser.snapshot",
      sessionId,
    });
    expect(snap).toMatchObject({ tabId: "t1", title: "CodeDen browser test", truncated: false });
    expect(snap.snapshot).toContain('button "Press me"');
    const name = refOf(snap.snapshot, /textbox "Name"/);
    const greet = refOf(snap.snapshot, /button "Greet"/);

    await browser.execute({ name: "browser.type", sessionId, ref: name, text: "Agent" });
    await browser.execute({ name: "browser.click", sessionId, ref: greet });
    expect(await manager.get(sessionId).page().textContent("#out")).toBe("Hello Agent");

    // Unchanged elements keep their refs across snapshots.
    const again = await browser.handlers["browser.snapshot"]({
      name: "browser.snapshot",
      sessionId,
    });
    expect(refOf(again.snapshot, /button "Greet"/)).toBe(greet);

    await browser.execute({ name: "browser.press", sessionId, key: "Shift+Tab" });
    await expect(
      browser.execute({ name: "browser.click", sessionId, ref: "e9999" }),
    ).rejects.toMatchObject({ code: "action_failed" });
  });

  it("writes viewport, full-page and element screenshots as valid PNGs", async () => {
    const path = join(dir, "shots", "viewport.png");
    const shot = await browser.handlers["browser.screenshot"]({
      name: "browser.screenshot",
      sessionId,
      path,
    });
    const file = readFileSync(path);
    expect(pngSize(file)).toEqual({ width: 1280, height: 800 });
    expect(shot).toEqual({ path, width: 1280, height: 800, bytes: file.length });

    const snap = await browser.handlers["browser.snapshot"]({
      name: "browser.snapshot",
      sessionId,
    });
    const element = await browser.handlers["browser.screenshot"]({
      name: "browser.screenshot",
      sessionId,
      path: join(dir, "element.png"),
      ref: refOf(snap.snapshot, /button "Press me"/),
    });
    expect(element.width).toBeLessThan(400);
    expect(element.height).toBeLessThan(200);

    const full = await browser.handlers["browser.screenshot"]({
      name: "browser.screenshot",
      sessionId,
      path: join(dir, "full.png"),
      fullPage: true,
    });
    expect(full.width).toBe(1280);
    await expect(
      browser.execute({ name: "browser.screenshot", sessionId, path: "relative.png" }),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("keeps bounded console and network logs", async () => {
    const all = await browser.handlers["browser.logs"]({ name: "browser.logs", sessionId });
    expect(all.console.some((e) => e.level === "log" && e.text === "page ready")).toBe(true);
    const ping = all.network.find((e) => e.url.endsWith("/api/ping"));
    expect(ping).toMatchObject({ method: "GET", status: 200, failure: null, tabId: "t1" });

    await manager
      .get(sessionId)
      .page()
      .evaluate(() => console.error("boom"));
    const last = Math.max(...all.console.map((e) => e.id), ...all.network.map((e) => e.id));
    const newer = await browser.handlers["browser.logs"]({
      name: "browser.logs",
      sessionId,
      kind: "console",
      since: last,
    });
    expect(newer.network).toEqual([]);
    expect(newer.console.map((e) => [e.level, e.text])).toEqual([["error", "boom"]]);
  });

  it("evaluates with a timeout and a size cap, and can be disabled", async () => {
    const title = await browser.handlers["browser.evaluate"]({
      name: "browser.evaluate",
      sessionId,
      expression: "() => document.title",
    });
    expect(title).toEqual({ json: '"CodeDen browser test"', truncated: false });

    const big = await browser.handlers["browser.evaluate"]({
      name: "browser.evaluate",
      sessionId,
      expression: "'x'.repeat(50000)",
    });
    expect(big.truncated).toBe(true);
    expect(big.json.length).toBe(20_000);

    await expect(
      browser.execute({ name: "browser.evaluate", sessionId, expression: "new Promise(() => {})" }),
    ).rejects.toMatchObject({ code: "timeout" });
    await expect(
      browser.execute({ name: "browser.evaluate", sessionId, expression: "throw new Error('x')" }),
    ).rejects.toMatchObject({ code: "evaluate_failed" });

    manager.evaluateGuard.enabled = false;
    try {
      await expect(
        browser.execute({ name: "browser.evaluate", sessionId, expression: "1" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      manager.evaluateGuard.enabled = true;
    }
  });

  it("waits for text, selectors and network idle", async () => {
    await browser.execute({ name: "browser.navigate", sessionId, url: `${site.url}/later` });
    const text = await browser.handlers["browser.wait"]({
      name: "browser.wait",
      sessionId,
      text: "arrived late",
    });
    expect(text.matched).toBe(true);
    const idle = await browser.handlers["browser.wait"]({
      name: "browser.wait",
      sessionId,
      networkIdle: true,
    });
    expect(idle.matched).toBe(true);
    const missing = await browser.handlers["browser.wait"]({
      name: "browser.wait",
      sessionId,
      selector: "#never",
      timeoutMs: 200,
    });
    expect(missing.matched).toBe(false);
    await expect(
      browser.execute({ name: "browser.wait", sessionId, text: "a", selector: "b" }),
    ).rejects.toMatchObject({ code: "invalid_wait" });
  });
});
