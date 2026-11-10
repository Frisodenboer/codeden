import type { BrowserInput, BrowserTab, RunnerStream } from "@codeden/contracts";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { CommandError } from "../errors";
import { InputForwarder } from "./input";
import { BrowserLogs } from "./logs";
import { type FrameStream, Screencast } from "./screencast";
import { normalizeUrl } from "./urls";
import {
  deviceMetricsParams,
  fitViewport,
  framePixels,
  sameViewport,
  type ViewportMetrics,
} from "./viewport";

export interface BrowserSessionOptions {
  sessionId: string;
  /** Created with `viewport: null`: the session emulates the viewport itself over CDP. */
  context: BrowserContext;
  viewport: ViewportMetrics;
  stream: (data: RunnerStream) => void;
  /** Default timeout for navigation and agent actions. */
  timeoutMs: number;
}

interface TabState {
  tabId: string;
  page: Page;
  cdp?: Promise<CDPSession>;
  /** Settles once the session's viewport is emulated on the tab. */
  sized: Promise<void>;
}

/**
 * One CodeDen session's isolated browser context (§12.2): its tabs, the active tab the
 * panel shows, the screencast, input forwarding and bounded console/network logs.
 */
export class BrowserSession {
  readonly sessionId: string;
  readonly context: BrowserContext;
  readonly logs = new BrowserLogs();
  readonly screencast: Screencast;
  private readonly tabs = new Map<string, TabState>();
  private readonly titles = new Map<string, string>();
  private readonly byPage = new WeakMap<Page, TabState>();
  private readonly input = new InputForwarder();
  private readonly stream: (data: RunnerStream) => void;
  private activeTabId: string | undefined;
  private nextTab = 1;
  private viewport: ViewportMetrics;
  private closed = false;
  private lastPublished = "";
  readonly timeoutMs: number;

  constructor(opts: BrowserSessionOptions) {
    this.sessionId = opts.sessionId;
    this.context = opts.context;
    this.viewport = opts.viewport;
    this.stream = opts.stream;
    this.timeoutMs = opts.timeoutMs;
    this.context.setDefaultTimeout(opts.timeoutMs);
    this.context.setDefaultNavigationTimeout(opts.timeoutMs);
    this.screencast = new Screencast(opts.sessionId, (frame: FrameStream) => this.stream(frame));
    void this.screencast.setFrameSize(framePixels(this.viewport));
    // Pages opened by the page itself (popups, target=_blank) become tabs too.
    this.context.on("page", (page) => {
      if (!this.byPage.has(page)) this.register(page, false);
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** The viewport every tab is emulated at (CSS pixels and device scale factor). */
  get viewportSize(): ViewportMetrics {
    return { ...this.viewport };
  }

  listTabs(): BrowserTab[] {
    return [...this.tabs.values()].map(({ tabId, page }) => ({
      tabId,
      url: page.url(),
      title: this.titles.get(tabId) ?? "",
      active: tabId === this.activeTabId,
    }));
  }

  /** Open a new tab (optionally at `url`) and make it active. */
  async openTab(url?: string): Promise<BrowserTab> {
    this.assertOpen();
    const page = await this.context.newPage();
    const state = this.byPage.get(page) ?? this.register(page, true);
    await this.activate(state.tabId);
    if (url) await this.navigate(url, state.tabId);
    return this.tabInfo(state.tabId);
  }

  async closeTab(tabId: string): Promise<void> {
    const state = this.tabState(tabId);
    await state.page.close();
  }

  /** Make a tab the one the panel shows and commands target by default. */
  async activate(tabId: string): Promise<void> {
    const state = this.tabState(tabId);
    if (this.activeTabId !== tabId) {
      this.activeTabId = tabId;
      this.publishTabs();
    }
    await state.page.bringToFront().catch(() => undefined);
    await state.sized;
    await this.screencast.setTab({ tabId, cdp: await this.cdp(state) });
  }

  /** The page of `tabId`, or of the active tab. */
  page(tabId?: string): Page {
    return this.tabState(tabId).page;
  }

  /** Resolve a tab id (default: the active tab). */
  tabId(tabId?: string): string {
    return this.tabState(tabId).tabId;
  }

  async navigate(url: string, tabId?: string): Promise<{ url: string; status: number | null }> {
    const page = this.page(tabId);
    const response = await page.goto(normalizeUrl(url), { waitUntil: "domcontentloaded" });
    await this.refreshTitle(page);
    return { url: page.url(), status: response?.status() ?? null };
  }

  async history(action: "back" | "forward" | "reload", tabId?: string): Promise<string> {
    const page = this.page(tabId);
    const options = { waitUntil: "domcontentloaded" as const };
    if (action === "back") await page.goBack(options);
    else if (action === "forward") await page.goForward(options);
    else await page.reload(options);
    await this.refreshTitle(page);
    return page.url();
  }

  /**
   * Set the viewport of every tab, and of tabs opened later. The request is clamped
   * (`fitViewport`); the screencast follows with frames at the new device pixels.
   * Returns what was applied.
   */
  async setViewport(request: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<ViewportMetrics> {
    this.assertOpen();
    const next = fitViewport(request);
    if (sameViewport(next, this.viewport)) return { ...next };
    this.viewport = next;
    await Promise.all(
      [...this.tabs.values()].map((state) => {
        state.sized = this.emulate(state);
        return state.sized;
      }),
    );
    await this.screencast.setFrameSize(framePixels(next));
    return { ...next };
  }

  /** Forward panel input to the active tab. */
  async dispatchInput(input: BrowserInput): Promise<void> {
    const state = this.tabState();
    await this.input.dispatch(await this.cdp(state), input, this.viewport);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.screencast.dispose();
    await this.context.close().catch(() => undefined);
    this.tabs.clear();
    this.activeTabId = undefined;
  }

  private register(page: Page, quiet: boolean): TabState {
    const tabId = `t${this.nextTab++}`;
    const state: TabState = { tabId, page, sized: Promise.resolve() };
    this.tabs.set(tabId, state);
    this.byPage.set(page, state);
    this.logs.attach(page, tabId);
    state.sized = this.emulate(state);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) void this.refreshTitle(page);
    });
    page.on("load", () => void this.refreshTitle(page));
    page.on("close", () => void this.onClosed(state));
    if (!this.activeTabId) void this.activate(tabId).catch(() => undefined);
    else if (!quiet) this.publishTabs();
    return state;
  }

  private async onClosed(state: TabState): Promise<void> {
    this.tabs.delete(state.tabId);
    this.titles.delete(state.tabId);
    if (this.closed) return;
    if (this.activeTabId === state.tabId) {
      this.activeTabId = undefined;
      const next = [...this.tabs.keys()].at(-1);
      if (next) await this.activate(next).catch(() => undefined);
      else await this.screencast.setTab(undefined);
    }
    this.publishTabs();
  }

  private async refreshTitle(page: Page): Promise<void> {
    const state = this.byPage.get(page);
    if (!state || page.isClosed()) return;
    this.titles.set(state.tabId, await page.title().catch(() => ""));
    this.publishTabs();
  }

  /** Emulate the session viewport on a tab (never throws: a closing tab just stays as is). */
  private async emulate(state: TabState): Promise<void> {
    try {
      const cdp = await this.cdp(state);
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        deviceMetricsParams(this.viewport) as never,
      );
    } catch {
      // The tab closed under us.
    }
  }

  private cdp(state: TabState): Promise<CDPSession> {
    state.cdp ??= this.context.newCDPSession(state.page);
    return state.cdp;
  }

  private tabInfo(tabId: string): BrowserTab {
    const tab = this.listTabs().find((t) => t.tabId === tabId);
    if (!tab) throw new CommandError("not_found", `No tab ${tabId}`);
    return tab;
  }

  private tabState(tabId?: string): TabState {
    this.assertOpen();
    const id = tabId ?? this.activeTabId;
    const state = id ? this.tabs.get(id) : undefined;
    if (!state) {
      throw new CommandError(
        "not_found",
        tabId ? `No tab ${tabId}` : "The session has no open tab",
      );
    }
    return state;
  }

  private assertOpen(): void {
    if (this.closed) throw new CommandError("not_found", "The browser session is closed");
  }

  private publishTabs(): void {
    if (this.closed) return;
    const tabs = this.listTabs();
    const key = JSON.stringify(tabs);
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.stream({ kind: "browser.tabs", sessionId: this.sessionId, tabs });
  }
}
