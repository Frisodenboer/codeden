import type {
  BrowserCookie,
  BrowserHandoffTab,
  BrowserRelayEndpoint,
  BrowserTab,
  RunnerStream,
} from "@codeden/contracts";
import { CommandError } from "../errors";
import { isAlive, killTree } from "../process/tree";
import { DEFAULT_EVALUATE_GUARD, type EvaluateGuard } from "./agent";
import { type LaunchedBrowser, type LaunchOptions, launchChromium } from "./launcher";
import { connectRelay, type RelayConnection, toPlaywrightCookies } from "./relay";
import { BrowserSession } from "./session";
import { devServerUrl } from "./urls";
import { DEFAULT_VIEWPORT, fitViewport, type ViewportMetrics } from "./viewport";

export interface BrowserManagerOptions extends LaunchOptions {
  /** Ephemeral runner -> server stream (frames, tab updates). */
  stream: (data: RunnerStream) => void;
  /**
   * Viewport of a session's first context until a panel sizes it. Default 1280x800 at 1x.
   * After that a reopened session browser keeps its last viewport.
   */
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  /** Default timeout for navigation and agent actions. Default 30s. */
  timeoutMs?: number;
  evaluate?: Partial<EvaluateGuard>;
  /** Replace the launcher (tests). */
  launch?: (opts: LaunchOptions) => Promise<LaunchedBrowser>;
  /** Replace the relay connection (tests). */
  connect?: (endpoint: BrowserRelayEndpoint) => Promise<RelayConnection>;
}

/**
 * The runner's browser (§12.2). Each CodeDen session has one browser, on one of two engines:
 *
 * - `runner`: an isolated `BrowserContext` in one Chromium the runner launches lazily (its CDP
 *   endpoint stays on 127.0.0.1);
 * - `native`: the desktop app's views for that session, reached through the app's per-session
 *   CDP relay (§17 Phase 2). When the app quits, the session moves to the runner's Chromium
 *   (`handoff`); if the relay just drops, its tabs reopen there at their last URLs.
 *
 * Agents and the panel drive the same tabs either way.
 */
export class BrowserManager {
  private launched: LaunchedBrowser | undefined;
  private launching: Promise<LaunchedBrowser> | undefined;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly opening = new Map<string, Promise<BrowserSession>>();
  private readonly lastViewport = new Map<string, ViewportMetrics>();
  private shuttingDown = false;
  readonly evaluateGuard: EvaluateGuard;

  constructor(private readonly opts: BrowserManagerOptions) {
    this.evaluateGuard = { ...DEFAULT_EVALUATE_GUARD, ...opts.evaluate };
  }

  /** CDP endpoint of the running browser, or null before the first launch. */
  get cdpUrl(): string | null {
    return this.launched?.cdpUrl ?? null;
  }

  /** Browser process id, or null when not running. */
  get pid(): number | null {
    return this.launched?.pid ?? null;
  }

  /** Channel that was launched (`msedge`, `chrome`, ...), or null. */
  get channel(): string | null {
    return this.launched?.channel ?? null;
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Launch the browser if it is not running yet. */
  async ensureBrowser(): Promise<LaunchedBrowser> {
    if (this.shuttingDown) throw new CommandError("unavailable", "The browser is shutting down");
    if (this.launched?.browser.isConnected()) return this.launched;
    this.launching ??= (this.opts.launch ?? launchChromium)(this.opts)
      .then((launched) => {
        this.launched = launched;
        launched.browser.on("disconnected", () => this.onDisconnected(launched));
        return launched;
      })
      .finally(() => {
        this.launching = undefined;
      });
    return this.launching;
  }

  /**
   * Open (or reuse) a session's browser; opens a first tab, at `url` if given. A session that
   * has none yet uses the desktop app's views when `relay` is given, else the runner's Chromium.
   */
  async open(
    sessionId: string,
    url?: string,
    relay?: BrowserRelayEndpoint,
  ): Promise<BrowserSession> {
    const session = await this.ensureSession(sessionId, relay);
    if (session.listTabs().length === 0) await session.openTab(url);
    else if (url) await session.navigate(url);
    return session;
  }

  /** The session's browser state; throws `not_found` if `browser.open` was not called. */
  get(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.isClosed) {
      throw new CommandError("not_found", `No browser for session ${sessionId}; open it first`);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isClosed === false;
  }

  /** Open a local dev server in a new tab of the session. */
  async openDevServer(sessionId: string, port: number, path = "/"): Promise<BrowserTab> {
    const session = await this.ensureSession(sessionId);
    return session.openTab(devServerUrl(port, path));
  }

  /** Set a session's viewport (clamped) and remember it for when its browser reopens. */
  async setViewport(
    sessionId: string,
    request: { width: number; height: number; deviceScaleFactor?: number },
  ): Promise<ViewportMetrics> {
    const session = this.get(sessionId);
    const applied = await session.setViewport(request);
    if (session.engine === "runner") this.lastViewport.set(sessionId, applied);
    return applied;
  }

  /**
   * Move a session to the runner's Chromium (§17 Phase 2: the desktop app quits): drop its
   * relay without closing the views, add `cookies` to a fresh context and reopen each tab at
   * its URL. Whatever page state lived only in the views is lost.
   */
  async handoff(
    sessionId: string,
    tabs: readonly BrowserHandoffTab[],
    cookies: readonly BrowserCookie[],
  ): Promise<BrowserSession> {
    const previous = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    await previous?.close();
    const session = await this.ensureSession(sessionId);
    for (const cookie of toPlaywrightCookies(cookies)) {
      // One at a time: a cookie Chromium refuses shouldn't cost the others.
      await session.context.addCookies([cookie]).catch(() => undefined);
    }
    const opened: string[] = [];
    for (const tab of tabs.length > 0 ? tabs : [{ url: "about:blank", active: true }]) {
      const url = tab.url === "about:blank" ? undefined : tab.url;
      const info = await session.openTab().catch(() => null);
      if (!info) continue;
      opened.push(info.tabId);
      if (url) await session.navigate(url, info.tabId).catch(() => undefined);
    }
    const active = tabs.findIndex((t) => t.active);
    const activeId = opened[active >= 0 ? active : opened.length - 1];
    if (activeId) await session.activate(activeId).catch(() => undefined);
    this.opts.log?.(`browser: session ${sessionId} moved to the runner's browser`);
    return session;
  }

  /** Close a session's browser; native views close too. */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    await session?.close({ closeTabs: true });
  }

  /**
   * Close every context and the browser, then kill whatever is left of its process tree.
   * Native sessions only disconnect: their views stay in the desktop app.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.launching?.catch(() => undefined);
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
    this.sessions.clear();
    const launched = this.launched;
    this.launched = undefined;
    if (!launched) return;
    await Promise.race([
      launched.browser.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (launched.pid !== null && isAlive(launched.pid)) await killTree(launched.pid);
  }

  private async ensureSession(
    sessionId: string,
    relay?: BrowserRelayEndpoint,
  ): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing && !existing.isClosed) return existing;
    let pending = this.opening.get(sessionId);
    if (!pending) {
      pending = (relay ? this.openNative(sessionId, relay) : this.openRunner(sessionId)).finally(
        () => this.opening.delete(sessionId),
      );
      this.opening.set(sessionId, pending);
    }
    return pending;
  }

  private async openRunner(sessionId: string): Promise<BrowserSession> {
    const { browser } = await this.ensureBrowser();
    // A reopened browser comes back at the size the panel last gave it.
    const viewport =
      this.lastViewport.get(sessionId) ?? fitViewport(this.opts.viewport ?? DEFAULT_VIEWPORT);
    // No Playwright viewport: the session emulates size and scale itself over CDP, so one
    // override owns the metrics (Playwright fixes the scale factor per context).
    const context = await browser.newContext({ viewport: null });
    const session = new BrowserSession({
      sessionId,
      context,
      viewport,
      stream: this.opts.stream,
      timeoutMs: this.opts.timeoutMs ?? 30_000,
    });
    this.sessions.set(sessionId, session);
    return session;
  }

  private async openNative(
    sessionId: string,
    relay: BrowserRelayEndpoint,
  ): Promise<BrowserSession> {
    if (this.shuttingDown) throw new CommandError("unavailable", "The browser is shutting down");
    const { browser, context } = await (this.opts.connect ?? connectRelay)(relay);
    const session = new BrowserSession({
      sessionId,
      context,
      viewport: fitViewport(this.opts.viewport ?? DEFAULT_VIEWPORT),
      stream: this.opts.stream,
      timeoutMs: this.opts.timeoutMs ?? 30_000,
      engine: "native",
      disconnect: () => browser.close(),
    });
    this.sessions.set(sessionId, session);
    browser.on("disconnected", () => void this.onRelayLost(sessionId, session));
    this.opts.log?.(`browser: session ${sessionId} uses the desktop app's views`);
    return session;
  }

  /**
   * The app went away without handing the session over (it crashed, or its server was gone):
   * reopen the tabs it had in the runner's Chromium, without their cookies.
   */
  private async onRelayLost(sessionId: string, session: BrowserSession): Promise<void> {
    if (this.sessions.get(sessionId) !== session || session.isClosed) return;
    const tabs = session.markDisconnected();
    this.sessions.delete(sessionId);
    if (this.shuttingDown || tabs.length === 0) {
      this.opts.stream({ kind: "browser.tabs", sessionId, tabs: [] });
      return;
    }
    this.opts.log?.(`browser: lost the desktop app's views of session ${sessionId}; reopening`);
    await this.handoff(sessionId, tabs, []).catch((error: unknown) => {
      this.opts.log?.(`browser: could not reopen session ${sessionId}: ${String(error)}`);
      this.opts.stream({ kind: "browser.tabs", sessionId, tabs: [] });
    });
  }

  private onDisconnected(launched: LaunchedBrowser): void {
    if (this.launched !== launched) return;
    // Crashed or killed: drop state so the next command relaunches.
    this.opts.log?.("browser: disconnected");
    this.launched = undefined;
    for (const [id, session] of this.sessions) {
      if (session.engine !== "runner") continue;
      void session.close();
      this.sessions.delete(id);
    }
  }
}
