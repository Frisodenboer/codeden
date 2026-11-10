import { randomBytes } from "node:crypto";
import type { NativeBrowserShortcut } from "@codeden/contracts";
import {
  type BrowserWindow,
  clipboard,
  Menu,
  type Session,
  shell,
  type WebContents,
  WebContentsView,
  type WebPreferences,
} from "electron";
import { sameRect, type ViewRect } from "./bounds";
import { contextMenuTemplate } from "./context-menu";
import { type BrowserKeyAction, routeKey } from "./keys";
import { CdpRelay, type RelayHost, type RelayTarget } from "./relay";
import { isAllowedBrowserUrl, isExternalOnlyUrl } from "./urls";
import { ViewTarget } from "./view-target";

/** What a session's browser needs from the app. */
export interface SessionBrowserHost {
  window(): BrowserWindow | null;
  partition: Session;
  /** Size for tabs opened before a panel was measured (and the shown panel's otherwise). */
  defaultRect(): ViewRect;
  /** Tabs, the active tab or the relay's clients changed: place the views again. */
  changed(): void;
  onShortcut(shortcut: NativeBrowserShortcut): void;
  product: string;
  userAgent: string;
  log(message: string): void;
}

/** Locked-down web preferences for every native view. */
export const VIEW_PREFERENCES: WebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  webviewTag: false,
  // Agents keep working in background tabs and while the panel is closed.
  backgroundThrottling: false,
  spellcheck: true,
  safeDialogs: true,
  navigateOnDragDrop: false,
};

export interface NativeTab {
  view: WebContentsView;
  target: ViewTarget;
  rect: ViewRect | null;
  visible: boolean;
}

/**
 * One CodeDen session's native browser (§17 Phase 2): its tabs as `WebContentsView`s in the
 * session's own partition, laid over the CodeDen window, and the CDP relay the runner drives
 * them through. Views are hidden, never removed, while they live: a removed view stops
 * answering captures.
 */
export class SessionBrowser implements RelayHost {
  readonly relay: CdpRelay;
  readonly secret = randomBytes(32).toString("hex");
  readonly tabs: NativeTab[] = [];
  active: NativeTab | null = null;
  private readonly added = new Set<(target: RelayTarget) => void>();
  private disposed = false;

  constructor(
    readonly sessionId: string,
    private readonly host: SessionBrowserHost,
  ) {
    this.relay = new CdpRelay(this, {
      product: host.product,
      userAgent: host.userAgent,
      onConnections: () => host.changed(),
    });
  }

  get idle(): boolean {
    return this.tabs.length === 0 && this.relay.connectionCount === 0;
  }

  targets(): RelayTarget[] {
    return this.tabs.map((t) => t.target);
  }

  onTargetAdded(listener: (target: RelayTarget) => void): () => void {
    this.added.add(listener);
    return () => this.added.delete(listener);
  }

  async createTarget(url: string): Promise<RelayTarget> {
    const tab = await this.openTab({ url });
    return tab.target;
  }

  async closeTarget(target: RelayTarget): Promise<void> {
    const tab = this.tabs.find((t) => t.target === target);
    if (tab) this.removeTab(tab);
  }

  activateTarget(target: RelayTarget): void {
    const tab = this.tabs.find((t) => t.target === target);
    if (!tab || tab === this.active) return;
    this.active = tab;
    this.host.changed();
  }

  /** Close every tab and drop the runner (the app is quitting, or the browser was freed). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.relay.dispose();
    for (const tab of [...this.tabs]) this.removeTab(tab);
  }

  private newView(contents?: WebContents): WebContentsView {
    return new WebContentsView({
      webPreferences: { ...VIEW_PREFERENCES, session: this.host.partition },
      ...(contents ? { webContents: contents } : {}),
    });
  }

  /**
   * Open a tab: a fresh view at `url`, or a view a popup is already loading in (`window.open`,
   * `target=_blank`), adopted as is.
   */
  private async openTab(opts: {
    url?: string;
    popup?: WebContentsView;
    openerId?: string;
  }): Promise<NativeTab> {
    const win = this.host.window();
    if (!win || win.isDestroyed() || this.disposed) throw new Error("The CodeDen window is closed");
    const view = opts.popup ?? this.newView();
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    const rect = this.host.defaultRect();
    view.setBounds(rect);
    win.contentView.addChildView(view);
    const contents = view.webContents;
    // A view that never loaded a page has no renderer, and its debugger would never answer.
    if (!opts.popup) await contents.loadURL("about:blank");
    else if (!contents.getURL() && !contents.isLoading()) {
      await contents.loadURL(opts.url ?? "about:blank").catch(() => undefined);
    }
    const target = new ViewTarget(contents, opts.openerId, this.host.log);
    try {
      await target.attach();
    } catch (error) {
      win.contentView.removeChildView(view);
      contents.close();
      throw error;
    }
    const tab: NativeTab = { view, target, rect, visible: false };
    this.guard(tab);
    this.tabs.push(tab);
    this.active ??= tab;
    for (const listener of this.added) listener(target);
    this.host.changed();
    if (!opts.popup && opts.url && opts.url !== "about:blank") {
      contents.loadURL(opts.url).catch((e: unknown) => this.host.log(`browser: ${String(e)}`));
    }
    return tab;
  }

  private removeTab(tab: NativeTab): void {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    // Fail what waits on the view before it goes, so no agent call hangs.
    tab.target.markGone();
    if (this.active === tab) this.active = this.tabs.at(-1) ?? null;
    const win = this.host.window();
    if (win && !win.isDestroyed()) {
      if (tab.view.webContents.isFocused()) win.webContents.focus();
      win.contentView.removeChildView(tab.view);
    }
    tab.target.detach();
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.host.changed();
  }

  /** Navigation rules, popups as tabs, the context menu and keys for one view. */
  private guard(tab: NativeTab): void {
    const contents = tab.view.webContents;
    const refuse = (event: { preventDefault(): void }, url: string) => {
      if (isAllowedBrowserUrl(url)) return;
      event.preventDefault();
      if (isExternalOnlyUrl(url)) void shell.openExternal(url);
      else this.host.log(`browser: blocked navigation to ${url.slice(0, 200)}`);
    };
    contents.on("will-navigate", (event, url) => refuse(event, url));
    contents.on("will-frame-navigate", (event) => refuse(event, event.url));
    contents.on("will-redirect", (event, url) => refuse(event, url));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalOnlyUrl(url)) {
        void shell.openExternal(url);
        return { action: "deny" };
      }
      if (!isAllowedBrowserUrl(url)) return { action: "deny" };
      // Popups become tabs of the same session, keeping `window.opener`.
      return {
        action: "allow",
        overrideBrowserWindowOptions: { webPreferences: { ...VIEW_PREFERENCES } },
        createWindow: (options) => {
          const popup = this.newView((options as { webContents?: WebContents }).webContents);
          void this.openTab({ popup, url, openerId: tab.target.targetId }).catch((e: unknown) =>
            this.host.log(`browser: popup: ${String(e)}`),
          );
          return popup.webContents;
        },
      };
    });
    contents.on("render-process-gone", (_e, details) => {
      this.host.log(`browser: a tab's page crashed (${details.reason}); closing it`);
      this.removeTab(tab);
    });
    contents.on("before-input-event", (event, input) => {
      const route = routeKey(input, process.platform);
      if (!route) return;
      event.preventDefault();
      if (route.kind === "browser") return this.keyAction(tab, route.action);
      const win = this.host.window();
      if (win && !win.isDestroyed()) win.webContents.focus();
      this.host.onShortcut(route.shortcut);
    });
    contents.on("context-menu", (_e, params) => {
      const history = contents.navigationHistory;
      const template = contextMenuTemplate(
        params,
        { x: params.x, y: params.y },
        {
          canGoBack: history.canGoBack(),
          canGoForward: history.canGoForward(),
          back: () => history.goBack(),
          forward: () => history.goForward(),
          reload: () => contents.reload(),
          openInNewTab: (url) => void this.openTab({ url }).catch(() => undefined),
          copyText: (text) => clipboard.writeText(text),
          inspect: (x, y) => contents.inspectElement(x, y),
        },
      );
      const win = this.host.window();
      if (win && !win.isDestroyed()) Menu.buildFromTemplate(template).popup({ window: win });
    });
  }

  private keyAction(tab: NativeTab, action: BrowserKeyAction): void {
    const contents = tab.view.webContents;
    if (action === "reload") contents.reload();
    else if (action === "hardReload") contents.reloadIgnoringCache();
    else if (action === "back" && contents.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack();
    } else if (action === "forward" && contents.navigationHistory.canGoForward()) {
      contents.navigationHistory.goForward();
    } else if (action === "inspect") contents.openDevTools({ mode: "detach" });
  }

  /** Put the active tab at `rect` (or hide everything); every tab gets the panel's size. */
  place(rect: ViewRect | null): void {
    for (const tab of this.tabs) {
      if (rect && !sameRect(tab.rect, rect)) {
        tab.view.setBounds(rect);
        tab.rect = rect;
      }
      const visible = rect !== null && tab === this.active;
      if (visible === tab.visible) continue;
      tab.visible = visible;
      if (!visible && tab.view.webContents.isFocused()) this.host.window()?.webContents.focus();
      tab.view.setVisible(visible);
    }
  }
}
