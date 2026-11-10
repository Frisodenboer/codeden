import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import WebSocket from "ws";
import type { Json, RelayHost, RelayTarget } from "../../src/main/browser/relay";

/**
 * A real Chromium standing in for Electron in the relay tests: each relay target is a page in
 * its own browser context, reached over one flat CDP connection, the same way a view's
 * `webContents.debugger` works (one session per page, child sessions addressed by id).
 */

function installedChannel(): "msedge" | "chrome" | null {
  const win = process.platform === "win32";
  const roots = [
    process.env["PROGRAMFILES(X86)"],
    process.env.PROGRAMFILES,
    process.env.LOCALAPPDATA,
  ];
  const has = (channel: "msedge" | "chrome") => {
    if (win) {
      const rel =
        channel === "msedge"
          ? join("Microsoft", "Edge", "Application", "msedge.exe")
          : join("Google", "Chrome", "Application", "chrome.exe");
      return roots.some((r) => r && existsSync(join(r, rel)));
    }
    if (process.platform === "darwin") {
      return existsSync(
        channel === "msedge"
          ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
          : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      );
    }
    return channel === "msedge"
      ? existsSync("/opt/microsoft/msedge/msedge")
      : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome"].some(existsSync);
  };
  return (
    (win ? (["msedge", "chrome"] as const) : (["chrome", "msedge"] as const)).find(has) ?? null
  );
}

export const CHANNEL = installedChannel();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

type Listener = (method: string, params: Json, sessionId: string | undefined) => void;

export class RawChromium {
  private id = 0;
  private readonly waiting = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void }
  >();
  readonly listeners = new Set<Listener>();

  private constructor(
    private readonly browser: Browser,
    private readonly ws: WebSocket,
  ) {
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.id !== undefined) {
        const w = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) w?.reject(new Error(msg.error.message));
        else w?.resolve(msg.result);
        return;
      }
      for (const l of this.listeners) l(msg.method, msg.params ?? {}, msg.sessionId);
    });
  }

  static async launch(): Promise<RawChromium> {
    if (!CHANNEL) throw new Error("No installed Edge or Chrome");
    const port = await freePort();
    const browser = await chromium.launch({
      channel: CHANNEL,
      headless: true,
      args: [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
    });
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
    return new RawChromium(browser, ws);
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<unknown> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** A browser context per CodeDen session: its tabs are the relay's targets. */
  async host(): Promise<RawHost> {
    const { browserContextId } = (await this.send("Target.createBrowserContext")) as {
      browserContextId: string;
    };
    return new RawHost(this, browserContextId);
  }

  async close(): Promise<void> {
    this.ws.close();
    await this.browser.close();
  }
}

class RawTarget implements RelayTarget {
  gone = false;
  private readonly events = new Set<(m: string, p: Json, c?: string) => void>();
  private readonly goneListeners = new Set<() => void>();
  private readonly children = new Set<string>();

  constructor(
    private readonly raw: RawChromium,
    readonly targetId: string,
    private readonly session: string,
  ) {
    raw.listeners.add((method, params, sessionId) => {
      if (sessionId === session) {
        if (method === "Target.attachedToTarget") this.children.add(params.sessionId as string);
        for (const l of this.events) l(method, params, undefined);
      } else if (sessionId && this.children.has(sessionId)) {
        if (method === "Target.attachedToTarget") this.children.add(params.sessionId as string);
        for (const l of this.events) l(method, params, sessionId);
      } else if (method === "Target.detachedFromTarget" && params.sessionId === session) {
        this.markGone();
      }
    });
  }

  url() {
    return "";
  }
  title() {
    return "";
  }
  send(method: string, params: Json | undefined, child?: string): Promise<unknown> {
    if (this.gone) return Promise.reject(new Error("Target closed"));
    return this.raw.send(method, params ?? {}, child ?? this.session);
  }
  onEvent(l: (m: string, p: Json, c?: string) => void) {
    this.events.add(l);
    return () => this.events.delete(l);
  }
  onGone(l: () => void) {
    this.goneListeners.add(l);
    return () => this.goneListeners.delete(l);
  }
  markGone() {
    if (this.gone) return;
    this.gone = true;
    for (const l of this.goneListeners) l();
  }
}

export class RawHost implements RelayHost {
  readonly list: RawTarget[] = [];
  readonly activated: string[] = [];
  private readonly added = new Set<(t: RelayTarget) => void>();

  constructor(
    private readonly raw: RawChromium,
    private readonly contextId: string,
  ) {}

  targets() {
    return this.list;
  }
  async createTarget(url: string): Promise<RelayTarget> {
    const { targetId } = (await this.raw.send("Target.createTarget", {
      url,
      browserContextId: this.contextId,
    })) as { targetId: string };
    const { sessionId } = (await this.raw.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };
    const target = new RawTarget(this.raw, targetId, sessionId);
    this.list.push(target);
    for (const l of this.added) l(target);
    return target;
  }
  async closeTarget(target: RelayTarget): Promise<void> {
    const i = this.list.indexOf(target as RawTarget);
    if (i >= 0) this.list.splice(i, 1);
    (target as RawTarget).markGone();
    await this.raw.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
  }
  activateTarget(target: RelayTarget): void {
    this.activated.push(target.targetId);
  }
  onTargetAdded(l: (t: RelayTarget) => void) {
    this.added.add(l);
    return () => this.added.delete(l);
  }
}
