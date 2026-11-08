import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { app, powerSaveBlocker } from "electron";

/** A line-per-message log at `<home>/logs/desktop.log` (never tokens or URLs with them). */
export function fileLogger(file: string): (message: string) => void {
  mkdirSync(dirname(file), { recursive: true });
  return (message) => {
    const line = `${new Date().toISOString()} ${message.replace(/token=[^&\s]+/g, "token=***")}\n`;
    try {
      appendFileSync(file, line);
    } catch {
      // logging must never break the app
    }
    if (process.env.CODEDEN_DEBUG) process.stdout.write(line);
  };
}

/** Prevents system sleep while agents run (the display may still sleep). */
export class KeepAwake {
  private id: number | null = null;

  set(on: boolean): void {
    if (on && this.id === null) this.id = powerSaveBlocker.start("prevent-app-suspension");
    else if (!on && this.id !== null) {
      powerSaveBlocker.stop(this.id);
      this.id = null;
    }
  }

  get active(): boolean {
    return this.id !== null && powerSaveBlocker.isStarted(this.id);
  }
}

/** Open at login is supported by Electron on Windows and macOS. */
export const launchAtLoginSupported = process.platform === "win32" || process.platform === "darwin";

/** Apply "Open at login"; started that way, the app stays in the tray (`--hidden`). */
export function applyLaunchAtLogin(enabled: boolean): void {
  if (!launchAtLoginSupported || !app.isPackaged) return;
  const current = app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin;
  if (current === enabled) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
}

/** True when macOS opened the app as a login item (Windows passes `--hidden` instead). */
export function openedAtLogin(): boolean {
  return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true;
}

/**
 * Whether the macOS app carries a Developer ID signature (required for updates there). An
 * unsigned or ad-hoc signed app (a local or unsigned CI build) can't update itself.
 */
export function macSigned(appPath: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("codesign", ["-dv", "--verbose=2", appPath], (error, stdout, stderr) => {
      if (error) return resolve(false);
      resolve(/Authority=Developer ID Application/.test(`${stdout}${stderr}`));
    });
  });
}
