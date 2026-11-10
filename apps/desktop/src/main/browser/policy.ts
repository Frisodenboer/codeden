import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * Permissions a page in a native view may have: writing to the clipboard from a click (copy
 * buttons on docs sites). Everything else (camera, microphone, location, notifications,
 * devices, fullscreen, ...) is denied: these are dev servers and agent-driven pages, not the
 * user's daily browser.
 */
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

export function allowViewPermission(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** The session partition for a CodeDen session: in memory, never the app's own session. */
export function partitionName(sessionId: string): string {
  return `codeden-browser:${sessionId}`;
}

/**
 * Electron's user agent names the app and Electron; some sites treat that as an embedded
 * browser (sign-in pages refuse it). Native views present the plain Chrome user agent.
 */
export function browserUserAgent(appUserAgent: string): string {
  return appUserAgent
    .replace(/\s+Electron\/\S+/i, "")
    .replace(/\s+codeden\/\S+/i, "")
    .replace(/\s+CodeDen\/\S+/i, "");
}

/** `report.pdf` -> `report (1).pdf` until the name is free. */
export function uniquePath(dir: string, filename: string): string {
  const safe = basename(filename).replace(/[<>:"/\\|?*]/g, "_") || "download";
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(dir, safe);
  for (let n = 1; existsSync(candidate) && n < 1_000; n++) {
    candidate = join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}
