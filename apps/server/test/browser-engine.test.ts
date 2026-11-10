import {
  type BrowserHostServerMessage,
  type BrowserRelayEndpoint,
  defaultSettings,
  type Settings,
} from "@codeden/contracts";
import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";
import { BrowserHostLink } from "../src/services/browser/browser-host";
import { BrowserService } from "../src/services/browser/browser-service";
import type { RunnerPort } from "../src/services/runner-port";
import type { SessionRepo } from "../src/services/sessions/repo";

const relay: BrowserRelayEndpoint = {
  url: "ws://127.0.0.1:41000/cdp/s1",
  secret: "k".repeat(64),
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A connected desktop app on the host link that answers attach requests as told. */
function desktop(link: BrowserHostLink, answer: "attach" | "fail" | "silent" = "attach") {
  const sent: BrowserHostServerMessage[] = [];
  const events = link.handlers();
  const ws = {
    readyState: 1,
    close: () => {
      (ws as { readyState: number }).readyState = 3;
    },
    send: (data: string) => {
      const msg = JSON.parse(data) as BrowserHostServerMessage;
      sent.push(msg);
      if (msg.type !== "attach" || answer === "silent") return;
      const reply =
        answer === "attach"
          ? { type: "attached", id: msg.id, relay }
          : { type: "failed", id: msg.id, message: "The window is closing" };
      queueMicrotask(() =>
        events.onMessage?.(new MessageEvent("message", { data: JSON.stringify(reply) }), ws),
      );
    },
  } as unknown as WSContext;
  events.onOpen?.(new Event("open"), ws);
  const say = (msg: unknown) =>
    events.onMessage?.(new MessageEvent("message", { data: JSON.stringify(msg) }), ws);
  say({ type: "hello", version: "0.5.0" });
  return { sent, ws, say, close: () => events.onClose?.(new CloseEvent("close"), ws) };
}

/** The browser service over a fake runner that records what it was asked. */
function service(opts: { open?: boolean; settings?: Partial<Settings["desktop"]> } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  let open = opts.open ?? false;
  const runner = {
    request: async (command: Record<string, unknown>) => {
      requests.push(command);
      if (command.name === "browser.tabs.list") {
        if (!open) throw Object.assign(new Error("No browser"), { code: "not_found" });
        return { tabs: [], engine: "runner" };
      }
      if (command.name === "browser.open") {
        open = true;
        return { cdpUrl: null, tabs: [], engine: command.relay ? "native" : "runner" };
      }
      if (command.name === "browser.handoff" && command.sessionId === "broken") {
        throw new Error("runner refused");
      }
      return {};
    },
  } as unknown as RunnerPort;
  const repo = { get: () => ({}), find: () => ({}) } as unknown as SessionRepo;
  const settings = defaultSettings();
  settings.desktop = { ...settings.desktop, ...opts.settings };
  const browser = new BrowserService({ runner, repo, settings: () => settings });
  const opens = () => requests.filter((r) => r.name === "browser.open");
  return { browser, requests, opens };
}

describe("engine choice when a session's browser opens", () => {
  it("uses the desktop app's native views for the desktop window and for agents", async () => {
    const { browser, opens } = service();
    desktop(browser.host);
    await tick();
    expect(browser.host.available).toBe(true);
    expect((await browser.open("s1", undefined, { native: true })).engine).toBe("native");
    expect(opens()[0]).toMatchObject({ relay });

    const agent = service();
    desktop(agent.browser.host);
    await agent.browser.agentNavigate("s1", "http://localhost:5173");
    expect(agent.opens()[0]).toMatchObject({ relay });
  });

  it("uses the runner's Chromium for a plain browser tab, a phone, or without the app", async () => {
    const web = service();
    desktop(web.browser.host);
    expect((await web.browser.open("s1")).engine).toBe("runner");
    expect(web.opens()[0]?.relay).toBeUndefined();

    const noApp = service();
    expect((await noApp.browser.open("s1", undefined, { native: true })).engine).toBe("runner");
  });

  it("respects the setting, keeps an open browser's engine and falls back when the app fails", async () => {
    const off = service({ settings: { nativeBrowser: false } });
    desktop(off.browser.host);
    await off.browser.open("s1", undefined, { native: true });
    expect(off.opens()[0]?.relay).toBeUndefined();

    const already = service({ open: true });
    const app = desktop(already.browser.host);
    await already.browser.open("s1", undefined, { native: true });
    expect(already.opens()[0]?.relay).toBeUndefined();
    expect(app.sent.filter((m) => m.type === "attach")).toHaveLength(0);

    const failing = service();
    desktop(failing.browser.host, "fail");
    expect((await failing.browser.open("s1", undefined, { native: true })).engine).toBe("runner");
  });

  it("opens an agent's dev server as the first native tab", async () => {
    const { browser, opens } = service();
    desktop(browser.host);
    await browser.agentOpenDevServer("s1", 5173, "/app").catch(() => undefined);
    expect(opens()[0]).toMatchObject({ url: "http://localhost:5173/app", relay });
  });
});

describe("the desktop app's host link", () => {
  it("times out an app that never answers, and fails waiting attaches when it leaves", async () => {
    const link = new BrowserHostLink({ handoff: async () => [] });
    await expect(link.attach("s1")).rejects.toThrow(/No desktop app/);
    desktop(link, "silent");
    await expect(link.attach("s1", 20)).rejects.toThrow(/did not answer/);
    const waiting = link.attach("s1", 5_000);
    const app = desktop(link, "silent");
    await tick();
    app.close();
    await expect(waiting).rejects.toThrow(/disconnected|answer/);
    expect(link.available).toBe(false);
  });

  it("lets the newest app take over", async () => {
    const link = new BrowserHostLink({ handoff: async () => [] });
    const first = desktop(link, "silent");
    const second = desktop(link);
    await tick();
    expect(first.ws.readyState).toBe(3);
    expect(await link.attach("s1")).toEqual(relay);
    expect(second.sent.map((m) => m.type)).toEqual(["attach"]);
  });

  it("moves the app's sessions to the runner on quit and reports the ones that failed", async () => {
    const { browser, requests } = service();
    const app = desktop(browser.host);
    const tabs = [{ url: "http://localhost:5173/", active: true }];
    const cookies = [
      { name: "sid", value: "1", domain: "localhost", path: "/", httpOnly: true, secure: false },
    ];
    app.say({
      type: "handoff",
      id: "h1",
      sessions: [
        { sessionId: "s1", tabs, cookies },
        { sessionId: "broken", tabs, cookies: [] },
      ],
    });
    for (let i = 0; i < 20 && !app.sent.some((m) => m.type === "handoff.done"); i++) await tick();
    expect(app.sent.find((m) => m.type === "handoff.done")).toEqual({
      type: "handoff.done",
      id: "h1",
      failed: ["broken"],
    });
    expect(requests.find((r) => r.name === "browser.handoff")).toEqual({
      name: "browser.handoff",
      sessionId: "s1",
      tabs,
      cookies,
    });
  });
});
