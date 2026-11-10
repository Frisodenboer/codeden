/**
 * What a native browser view may show (§17 Phase 2): the web, plus `about:blank`, `data:`
 * documents (agents use them for test pages) and same-origin `blob:` URLs. Browser-internal
 * pages (`chrome://`, `devtools://`, `edge://`), local files (`file://`) and `javascript:` are
 * refused, whoever asks: the page, the toolbar or an agent.
 */
const ALLOWED = new Set(["http:", "https:", "data:", "blob:"]);

export function isAllowedBrowserUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "about:") return url.pathname === "blank" || url.pathname === "srcdoc";
  return ALLOWED.has(url.protocol);
}

/** Links a page may hand to the OS instead (a `mailto:` in a page opens the mail app). */
export function isExternalOnlyUrl(raw: string): boolean {
  try {
    return ["mailto:", "tel:"].includes(new URL(raw).protocol);
  } catch {
    return false;
  }
}
