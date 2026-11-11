import { writeFileSync } from "node:fs";
import { app, BrowserWindow, nativeTheme, type Rectangle, screen, shell } from "electron";
import { allowPermission, externalUrl, isServerUrl, redactToken } from "./security";
import { readWindowState, restoreBounds, type WindowState } from "./window-state";
import { WindowZoom, type ZoomCommand } from "./zoom";

export interface MainWindowOptions {
  preload: string;
  icon: string;
  /** `<home>/desktop/window-state.json`. */
  stateFile: string;
  show: boolean;
  /** Close hides the window instead (keep running in the tray); read on every close. */
  hideOnClose: () => boolean;
  log: (message: string) => void;
}

/**
 * The CodeDen window (§17): the server's own UI, sandboxed and context-isolated, with only the
 * preload bridge. It can't navigate away from the server's origin; links open in the system
 * browser. It remembers its bounds and zoom, and hides to the tray on close when the setting
 * says so.
 */
export class MainWindow {
  readonly window: BrowserWindow;
  private readonly zoomControl: WindowZoom;
  private origin: string | null = null;
  private quitting = false;

  constructor(private readonly opts: MainWindowOptions) {
    const saved = readWindowState(opts.stateFile);
    // The primary display first: the default size is fitted to it.
    const displays = screen.getAllDisplays().map((d) => d.workArea);
    const bounds = restoreBounds(saved, [screen.getPrimaryDisplay().workArea, ...displays]);
    this.window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "CodeBench",
      icon: opts.icon,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0d10" : "#ffffff",
      autoHideMenuBar: process.platform !== "darwin",
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        // Keep the live connection and notifications timely while hidden in the tray.
        backgroundThrottling: false,
      },
    });
    if (bounds.maximized) this.window.maximize();
    this.zoomControl = new WindowZoom(this.window.webContents, saved?.zoomFactor, () =>
      this.saveState(),
    );
    this.window.once("ready-to-show", () => {
      if (opts.show) this.show();
    });
    this.guard();
    this.trackBounds();
  }

  /** Zoom the UI in or out a step, or back to 100% (View menu); saved with the window state. */
  zoom(command: ZoomCommand): void {
    if (!this.window.isDestroyed()) this.zoomControl.apply(command);
  }

  get zoomFactor(): number {
    return this.zoomControl.factor;
  }

  /** Load the server's UI (the launch URL authenticates and is replaced by a redirect). */
  async load(url: string): Promise<void> {
    this.origin = new URL(url).origin;
    try {
      await this.window.loadURL(url);
    } catch (error) {
      // The error quotes the launch URL, which carries the install token.
      throw new Error(redactToken(String(error)));
    }
  }

  get serverOrigin(): string | null {
    return this.origin;
  }

  show(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  /** Let the next close really close (Quit). */
  allowClose(): void {
    this.quitting = true;
  }

  /** Lock navigation to the server and hand everything else to the OS. */
  private guard(): void {
    const contents = this.window.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      const external = externalUrl(url);
      if (external && !(this.origin && isServerUrl(url, this.origin))) {
        void shell.openExternal(external);
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (this.origin && isServerUrl(url, this.origin)) return;
      event.preventDefault();
      const external = externalUrl(url);
      if (external) void shell.openExternal(external);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    const session = contents.session;
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const media = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      const ok =
        this.origin !== null && allowPermission(permission, wc.getURL(), this.origin, media);
      if (!ok) this.opts.log(`window: denied permission ${permission}`);
      callback(ok);
    });
    session.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
      this.origin === null
        ? false
        : allowPermission(
            permission,
            requestingOrigin,
            this.origin,
            permission === "media" ? ["audio"] : [],
          ),
    );
  }

  private trackBounds(): void {
    let timer: NodeJS.Timeout | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.saveState(), 400);
    };
    for (const event of ["resize", "move", "maximize", "unmaximize"] as const) {
      this.window.on(event as "resize", save);
    }
    this.window.on("close", (event) => {
      this.saveState();
      if (this.quitting) return;
      event.preventDefault();
      // Keep running in the tray, or (with that setting off) closing the window quits.
      if (this.opts.hideOnClose()) this.window.hide();
      else app.quit();
    });
  }

  private saveState(): void {
    if (this.window.isDestroyed() || this.window.isMinimized()) return;
    const b: Rectangle = this.window.isMaximized()
      ? this.window.getNormalBounds()
      : this.window.getBounds();
    const state: WindowState = {
      ...b,
      maximized: this.window.isMaximized(),
      zoomFactor: this.zoomControl.factor,
    };
    try {
      writeFileSync(this.opts.stateFile, JSON.stringify(state));
    } catch (error) {
      this.opts.log(`window: could not save its state: ${String(error)}`);
    }
  }
}
