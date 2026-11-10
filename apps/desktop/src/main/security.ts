/**
 * Navigation and permission rules for the CodeDen window (§15, §17). The window only ever
 * shows the local server's UI; everything else opens in the system browser.
 */

/** True when `url` is on the server's origin (scheme, host and port). */
export function isServerUrl(url: string, serverOrigin: string): boolean {
  try {
    return new URL(url).origin === serverOrigin;
  } catch {
    return false;
  }
}

/** A link that may be handed to the OS: http(s) or mailto, nothing else (no file:, no custom schemes). */
export function externalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Permissions the UI uses: notifications, the microphone for dictation, the clipboard, fullscreen. */
const ALLOWED = new Set([
  "notifications",
  "media",
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
]);

/** Grant a permission request only to the server's own pages, and only from the list above. */
export function allowPermission(
  permission: string,
  requestingUrl: string,
  serverOrigin: string,
  mediaTypes: readonly string[] = [],
): boolean {
  if (!ALLOWED.has(permission) || !isServerUrl(requestingUrl, serverOrigin)) return false;
  // Dictation needs the microphone, never the camera.
  if (permission === "media")
    return mediaTypes.length > 0 && mediaTypes.every((t) => t === "audio");
  return true;
}

/**
 * Text with any `token=` value replaced, for errors and logs. A failed load of the launch URL
 * (`/?token=…`) quotes the URL, and the install token must never reach a log.
 */
export function redactToken(text: string): string {
  return text.replace(/([?&]token=)[^&\s'"]+/gi, "$1[redacted]");
}
