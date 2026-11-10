import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BROWSER_RELAY_SECRET_HEADER } from "@codeden/contracts";
import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CdpRelay } from "../src/main/browser/relay";
import { RelayServer } from "../src/main/browser/relay-server";
import { CHANNEL, RawChromium, type RawHost } from "./support/raw-chromium";

const PAGE = `<!doctype html><title>Relay test</title>
<button onclick="document.title='clicked'">Press me</button>
<input aria-label="Name">
<script>console.log('page ready'); fetch('/ping')</script>`;

/**
 * The relay end to end with playwright-core's `connectOverCDP`, as the runner uses it, over a
 * real Chromium standing in for Electron's views: the agent primitives work through it, each
 * session sees only its own tabs and cookies, and a closed tab fails what waits on it.
 */
describe.skipIf(!CHANNEL)(
  "CDP relay with playwright (installed Edge/Chrome)",
  { timeout: 60_000 },
  () => {
    let raw: RawChromium;
    let site: Server;
    let base: string;
    let server: RelayServer;
    const sessions = new Map<string, { relay: CdpRelay; secret: string; host: RawHost }>();
    const browsers: Browser[] = [];

    const connect = async (sessionId: string, secret?: string) => {
      const port = await server.port();
      const s = sessions.get(sessionId);
      const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}/cdp/${sessionId}`, {
        headers: { [BROWSER_RELAY_SECRET_HEADER]: secret ?? s?.secret ?? "" },
        timeout: 10_000,
      });
      browsers.push(browser);
      return browser;
    };

    beforeAll(async () => {
      site = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://x");
        res.setHeader("content-type", "text/html");
        if (url.pathname === "/set")
          res.setHeader("set-cookie", `who=${url.searchParams.get("v")}`);
        res.end(url.pathname === "/" ? PAGE : "<title>ok</title>");
      });
      await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
      raw = await RawChromium.launch();
      for (const id of ["s1", "s2"]) {
        const host = await raw.host();
        const relay = new CdpRelay(host, { product: "Chrome/156", userAgent: "Mozilla/5.0" });
        sessions.set(id, { relay, secret: `${id}-${"x".repeat(40)}`, host });
      }
      server = new RelayServer(
        (id) => sessions.get(id) ?? null,
        () => {},
      );
    }, 60_000);

    afterAll(async () => {
      for (const b of browsers) {
        await Promise.race([
          b.close().catch(() => {}),
          new Promise((r) => setTimeout(r, 10_000).unref()),
        ]);
      }
      server?.close();
      await raw?.close();
      site?.close();
    }, 60_000);

    it("runs the runner's agent primitives through the relay", async () => {
      const browser = await connect("s1");
      const context = browser.contexts()[0];
      if (!context) throw new Error("no default context");
      const page = await context.newPage();
      const logs: string[] = [];
      const requests: string[] = [];
      page.on("console", (m) => logs.push(m.text()));
      page.on("request", (r) => requests.push(new URL(r.url()).pathname));
      expect((await page.goto(base))?.status()).toBe(200);

      const snapshot = await page.ariaSnapshot({ mode: "ai" });
      const ref = /button "Press me" \[ref=(\w+)\]/.exec(snapshot)?.[1];
      expect(ref).toBeTruthy();
      await page.locator(`aria-ref=${ref}`).click();
      expect(await page.title()).toBe("clicked");
      await page.getByLabel("Name").fill("Ada");
      await page.keyboard.press("End");
      expect(await page.getByLabel("Name").inputValue()).toBe("Ada");

      const shot = await page.screenshot({ scale: "css" });
      expect(shot.subarray(1, 4).toString()).toBe("PNG");
      await expect.poll(() => logs).toContain("page ready");
      await expect.poll(() => requests).toContain("/ping");

      // The screencast for phone viewers runs on an extra CDP session on the same view.
      const cdp = await context.newCDPSession(page);
      let frames = 0;
      cdp.on("Page.screencastFrame", (f) => {
        frames++;
        void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60 });
      await page.evaluate(() => {
        document.body.style.background = "#cfe";
      });
      await expect.poll(() => frames, { timeout: 5_000 }).toBeGreaterThan(0);
      await cdp.send("Page.stopScreencast");
      await cdp.detach();

      // Back and forward, and a second tab created by the app.
      await page.goto(`${base}/other`);
      await page.goBack();
      expect(page.url()).toBe(`${base}/`);
      const second = await context.newPage();
      expect(context.pages()).toHaveLength(2);
      await second.bringToFront();
      expect(sessions.get("s1")?.host.activated.at(-1)).toBeTruthy();
      await second.close();
      expect(sessions.get("s1")?.host.list).toHaveLength(1);
    });

    it("keeps sessions apart: tabs and cookies never cross", async () => {
      const one = await connect("s1");
      const two = await connect("s2");
      const pageOne = one.contexts()[0]?.pages()[0] ?? (await one.contexts()[0]?.newPage());
      const pageTwo = await two.contexts()[0]?.newPage();
      if (!pageOne || !pageTwo) throw new Error("no pages");
      await pageOne.goto(`${base}/set?v=one`);
      await pageTwo.goto(`${base}/set?v=two`);
      expect(await pageOne.evaluate(() => document.cookie)).toBe("who=one");
      expect(await pageTwo.evaluate(() => document.cookie)).toBe("who=two");
      expect(
        two
          .contexts()[0]
          ?.pages()
          .map((p) => p.url()),
      ).toEqual([`${base}/set?v=two`]);
      expect(
        one
          .contexts()[0]
          ?.pages()
          .some((p) => p.url().includes("v=two")),
      ).toBe(false);
    });

    it("refuses a wrong secret and a session that doesn't exist", async () => {
      await expect(connect("s1", "wrong-secret")).rejects.toThrow();
      await expect(connect("nope", "x".repeat(40))).rejects.toThrow();
    });

    it("fails a pending call at once when the tab goes away", async () => {
      const browser = await connect("s2");
      const page = await browser.contexts()[0]?.newPage();
      if (!page) throw new Error("no page");
      await page.goto(base);
      const pending = page.evaluate(() => new Promise(() => {}));
      const host = sessions.get("s2")?.host;
      const target = host?.list.at(-1);
      const started = Date.now();
      setTimeout(() => {
        if (target) void host?.closeTarget(target);
      }, 100);
      await expect(pending).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
    });
  },
);
