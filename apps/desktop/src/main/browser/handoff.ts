import type { BrowserCookie, BrowserHandoffTab } from "@codeden/contracts";
import { isAllowedBrowserUrl } from "./urls";

/** The fields of an Electron cookie the hand-off carries. */
export interface ElectronCookie {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

const SAME_SITE: Record<string, BrowserCookie["sameSite"]> = {
  no_restriction: "None",
  lax: "Lax",
  strict: "Strict",
};

/**
 * Cookies of a session's partition in the shape the runner's Chromium takes (§17 Phase 2:
 * quitting the app moves each tab to the runner with its cookies). Host-only cookies keep a
 * bare domain and domain cookies their leading dot, as CDP expects; session cookies have no
 * expiry; cookies the contract can't carry (empty domain, oversized) are dropped.
 */
export function toHandoffCookies(cookies: readonly ElectronCookie[]): BrowserCookie[] {
  const out: BrowserCookie[] = [];
  for (const c of cookies) {
    const bare = (c.domain ?? "").replace(/^\./, "");
    if (!bare || c.name.length > 4_096 || c.value.length > 16_384) continue;
    const sameSite = c.sameSite ? SAME_SITE[c.sameSite] : undefined;
    out.push({
      name: c.name,
      value: c.value,
      domain: c.hostOnly ? bare : `.${bare}`,
      path: c.path || "/",
      ...(c.session || c.expirationDate === undefined ? {} : { expires: c.expirationDate }),
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      ...(sameSite ? { sameSite } : {}),
    });
    if (out.length >= 5_000) break;
  }
  return out;
}

/**
 * The tabs to reopen in the runner's Chromium, in tab order: pages the runner may open (a
 * blank tab stays blank), with the active one marked.
 */
export function toHandoffTabs(
  tabs: ReadonlyArray<{ url: string; active: boolean }>,
): BrowserHandoffTab[] {
  return tabs.slice(0, 50).map((t) => ({ url: reopenable(t.url), active: t.active }));
}

/** `blob:` documents die with their page, and the runner refuses other schemes anyway. */
function reopenable(url: string): string {
  const ok = url.length <= 8_000 && isAllowedBrowserUrl(url) && /^(https?|data):/i.test(url);
  return ok ? url : "about:blank";
}
