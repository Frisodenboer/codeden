import { app, type BrowserWindow, nativeImage } from "electron";

/**
 * The count of things waiting on the user on the app icon: the dock badge on macOS, the
 * launcher count on Linux (Unity-compatible docks), a taskbar overlay dot on Windows.
 */
export class AppBadge {
  private count = -1;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly overlayIcon: string,
  ) {}

  set(count: number): void {
    const n = Number.isInteger(count) && count > 0 ? Math.min(count, 999) : 0;
    if (n === this.count) return;
    this.count = n;
    if (process.platform === "win32") {
      const win = this.window();
      if (!win || win.isDestroyed()) return;
      win.setOverlayIcon(
        n > 0 ? nativeImage.createFromPath(this.overlayIcon) : null,
        n > 0 ? `${n} waiting on you` : "",
      );
      return;
    }
    if (process.platform === "darwin") {
      app.dock?.setBadge(n > 0 ? String(n) : "");
      return;
    }
    app.setBadgeCount(n);
  }
}
