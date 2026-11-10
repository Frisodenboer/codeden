import {
  BROWSER_RELAY_SECRET_HEADER,
  type BrowserCookie,
  type BrowserRelayEndpoint,
} from "@codeden/contracts";
import { type Browser, type BrowserContext, chromium } from "playwright-core";
import { CommandError } from "../errors";

export interface RelayConnection {
  browser: Browser;
  /** The session's tabs: the relay shows exactly one session's views as one context. */
  context: BrowserContext;
}

/**
 * Connect to the desktop app's CDP relay for one session (§17 Phase 2). The relay looks like
 * a browser whose only context holds that session's native views; the runner's primitives
 * drive them exactly as they drive its own Chromium.
 */
export async function connectRelay(
  endpoint: BrowserRelayEndpoint,
  timeoutMs = 10_000,
): Promise<RelayConnection> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint.url, {
      // The secret travels in a header, so it never shows up in a URL or an error message.
      headers: { [BROWSER_RELAY_SECRET_HEADER]: endpoint.secret },
      timeout: timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new CommandError("browser_unavailable", `The desktop app's browser: ${message}`);
  }
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => undefined);
    throw new CommandError("browser_unavailable", "The desktop app's browser has no context");
  }
  return { browser, context };
}

/** Cookies from native views as playwright takes them (a session cookie has no expiry). */
export function toPlaywrightCookies(cookies: readonly BrowserCookie[]) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.expires ?? -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    // Chromium refuses SameSite=None without Secure; such a cookie falls back to the default.
    ...(c.sameSite && !(c.sameSite === "None" && !c.secure) ? { sameSite: c.sameSite } : {}),
  }));
}
