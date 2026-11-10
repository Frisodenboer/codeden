import type {
  BrowserHostClientMessage,
  BrowserRelayEndpoint,
  NativeBrowserBounds,
  NativeBrowserShortcut,
} from "@codeden/contracts";
import { app, type BrowserWindow } from "electron";
import { DEFAULT_VIEW_SIZE, toViewRect, type ViewRect } from "./bounds";
import { toHandoffCookies, toHandoffTabs } from "./handoff";
import { sessionPartition } from "./partition";
import { browserUserAgent } from "./policy";
import { RelayServer } from "./relay-server";
import { SessionBrowser } from "./session-browser";

export interface NativeBrowsersOptions {
  /** The CodeDen window the views are laid over. */
  window: () => BrowserWindow | null;
  /** Downloads go here (the OS Downloads folder). */
  downloads: () => string;
  /** An app shortcut pressed inside a view, for the UI. */
  onShortcut: (shortcut: NativeBrowserShortcut) => void;
  log: (message: string) => void;
}

type HandoffSessions = Extract<BrowserHostClientMessage, { type: "handoff" }>["sessions"];

/** What the desktop smoke test reads about the views. */
export interface NativeViewState {
  sessionId: string;
  url: string;
  active: boolean;
  visible: boolean;
  bounds: ViewRect | null;
}

/**
 * Every CodeDen session's native browser in this app (§17 Phase 2), and where they show: at
 * most one session's active tab is visible, over the panel the UI reported; everything else is
 * hidden. Sessions get their browser (partition, relay, secret) when the server attaches them
 * and lose it once they have no tabs and no runner connected (their cookies and storage go
 * with it, as a runner context's do).
 */
export class NativeBrowsers {
  private readonly sessions = new Map<string, SessionBrowser>();
  private readonly server: RelayServer;
  private shown: { sessionId: string; bounds: NativeBrowserBounds } | null = null;
  private lastRect: ViewRect | null = null;
  private closed = false;

  constructor(private readonly opts: NativeBrowsersOptions) {
    this.server = new RelayServer((sessionId) => {
      const s = this.sessions.get(sessionId);
      return s ? { relay: s.relay, secret: s.secret } : null;
    }, opts.log);
  }

  /** Create (or reuse) a session's native browser; the relay the runner should connect to. */
  async attach(sessionId: string): Promise<BrowserRelayEndpoint> {
    if (this.closed) throw new Error("The app is quitting");
    const win = this.opts.window();
    if (!win || win.isDestroyed()) throw new Error("The CodeDen window is closed");
    const port = await this.server.port();
    let browser = this.sessions.get(sessionId);
    if (!browser) {
      const partition = sessionPartition(sessionId, {
        downloads: this.opts.downloads,
        log: this.opts.log,
      });
      browser = new SessionBrowser(sessionId, {
        window: this.opts.window,
        partition,
        defaultRect: () => this.defaultRect(),
        changed: () => this.changed(sessionId),
        onShortcut: this.opts.onShortcut,
        product: `Chrome/${process.versions.chrome}`,
        userAgent: browserUserAgent(app.userAgentFallback),
        log: this.opts.log,
      });
      this.sessions.set(sessionId, browser);
      this.opts.log(`browser: native views for session ${sessionId}`);
    }
    return { url: `ws://127.0.0.1:${port}/cdp/${sessionId}`, secret: browser.secret };
  }

  /** Show the session's active tab over the panel (and hide every other view). */
  show(sessionId: string, bounds: NativeBrowserBounds): void {
    this.shown = { sessionId, bounds };
    this.layout();
  }

  hide(sessionId: string): void {
    if (this.shown?.sessionId !== sessionId) return;
    this.shown = null;
    this.layout();
  }

  /** A JPEG data URL of the session's active tab, for the UI's placeholder while it is hidden. */
  async capture(sessionId: string): Promise<string | null> {
    const tab = this.sessions.get(sessionId)?.active;
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    try {
      const image = await tab.view.webContents.capturePage();
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}`;
    } catch {
      return null;
    }
  }

  inspect(sessionId: string): void {
    const tab = this.sessions.get(sessionId)?.active;
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.openDevTools({ mode: "detach" });
    }
  }

  /** Every session with open tabs: its tabs' URLs and its cookies, for the hand-off on quit. */
  async handoffSessions(): Promise<HandoffSessions> {
    const out: HandoffSessions = [];
    for (const [sessionId, browser] of this.sessions) {
      if (browser.tabs.length === 0) continue;
      const tabs = toHandoffTabs(
        browser.tabs.map((t) => ({
          url: t.view.webContents.isDestroyed() ? "" : t.view.webContents.getURL(),
          active: t === browser.active,
        })),
      );
      const partition = sessionPartition(sessionId, {
        downloads: this.opts.downloads,
        log: this.opts.log,
      });
      const cookies = toHandoffCookies(await partition.cookies.get({}).catch(() => []));
      out.push({ sessionId, tabs, cookies });
    }
    return out;
  }

  /** Close every view and the relay listener (the app is quitting). */
  closeAll(): void {
    this.closed = true;
    for (const browser of this.sessions.values()) browser.dispose();
    this.sessions.clear();
    this.server.close();
  }

  /** Place the views again (the window zoom changed). */
  layout(): void {
    const win = this.opts.window();
    if (!win || win.isDestroyed()) return;
    const content = win.getContentBounds();
    const shown = this.shown;
    const rect = shown ? toViewRect(shown.bounds, win.webContents.getZoomFactor(), content) : null;
    if (rect) this.lastRect = rect;
    for (const [sessionId, browser] of this.sessions) {
      browser.place(shown?.sessionId === sessionId ? rect : null);
    }
  }

  views(): NativeViewState[] {
    const out: NativeViewState[] = [];
    for (const [sessionId, browser] of this.sessions) {
      for (const tab of browser.tabs) {
        out.push({
          sessionId,
          url: tab.view.webContents.isDestroyed() ? "" : tab.view.webContents.getURL(),
          active: tab === browser.active,
          visible: tab.visible,
          bounds: tab.rect,
        });
      }
    }
    return out;
  }

  /** New tabs start at the panel's last size (agents' screenshots match what you'd see). */
  private defaultRect(): ViewRect {
    return this.lastRect ?? { x: 0, y: 0, ...DEFAULT_VIEW_SIZE };
  }

  private changed(sessionId: string): void {
    const browser = this.sessions.get(sessionId);
    if (browser?.idle && !this.closed) {
      // Nothing open and nobody connected: free the partition like a closed runner context.
      browser.dispose();
      this.sessions.delete(sessionId);
      void sessionPartition(sessionId, { downloads: this.opts.downloads, log: this.opts.log })
        .clearStorageData()
        .catch(() => undefined);
      this.opts.log(`browser: freed native views of session ${sessionId}`);
    }
    this.layout();
  }
}
