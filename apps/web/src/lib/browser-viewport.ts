import type { BrowserViewportSize } from "@codeden/contracts";

/** Quiet time after the last resize before the page is resized. */
export const VIEWPORT_DEBOUNCE_MS = 120;
/** During a long drag, resize the page at least this often so it keeps up. */
export const VIEWPORT_MAX_WAIT_MS = 400;

/** A panel's content box as a viewport request (whole CSS pixels, at least 1x1). */
export function panelViewport(width: number, height: number, dpr: number): BrowserViewportSize {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    // Two decimals, within the contract's range; the runner applies its own limits.
    deviceScaleFactor: Math.min(Math.max(Math.round((dpr || 1) * 100) / 100, 0.25), 8),
  };
}

export function sameViewportSize(a: BrowserViewportSize | null, b: BrowserViewportSize): boolean {
  return (
    !!a &&
    a.width === b.width &&
    a.height === b.height &&
    a.deviceScaleFactor === b.deviceScaleFactor
  );
}

export interface ViewportReporter {
  /** A new measurement: the first goes out at once, later ones once resizing settles. */
  measure(size: BrowserViewportSize): void;
  /** Send the latest size now as a claim (this viewer was focused or used). */
  claim(): void;
  dispose(): void;
}

/**
 * Debounces panel sizes into `viewport` messages: the first size immediately (so the first
 * frame is already the right size), then a trailing debounce with a max wait while a resize
 * drags on. Unchanged sizes are not resent.
 */
export function createViewportReporter(
  send: (size: BrowserViewportSize, claim: boolean) => void,
  opts: { debounceMs?: number; maxWaitMs?: number } = {},
): ViewportReporter {
  const debounceMs = opts.debounceMs ?? VIEWPORT_DEBOUNCE_MS;
  const maxWaitMs = opts.maxWaitMs ?? VIEWPORT_MAX_WAIT_MS;
  let sent: BrowserViewportSize | null = null;
  let latest: BrowserViewportSize | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSince: number | null = null;

  const flush = (claim: boolean) => {
    clearTimeout(timer);
    timer = undefined;
    pendingSince = null;
    if (!latest) return;
    if (!claim && sameViewportSize(sent, latest)) return;
    sent = latest;
    send(latest, claim);
  };

  return {
    measure(size) {
      latest = size;
      if (!sent) return flush(false);
      if (sameViewportSize(sent, size)) {
        clearTimeout(timer);
        timer = undefined;
        pendingSince = null;
        return;
      }
      const now = Date.now();
      pendingSince ??= now;
      const wait = Math.min(debounceMs, Math.max(0, pendingSince + maxWaitMs - now));
      clearTimeout(timer);
      timer = setTimeout(() => flush(false), wait);
    },
    claim() {
      flush(true);
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
