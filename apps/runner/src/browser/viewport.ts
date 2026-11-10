/**
 * Viewport sizing for the session browser (§12.2). The panel asks for its own size and
 * `devicePixelRatio`; the runner clamps the request here and emulates it on every tab with
 * `Emulation.setDeviceMetricsOverride`, then sizes the screencast to the resulting pixels.
 */

/** A page viewport: CSS pixels plus the device scale factor it renders at. */
export interface ViewportMetrics {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export const VIEWPORT_LIMITS = {
  /**
   * Smallest CSS size. 320 wide is the narrowest layout sites still design for; a smaller
   * panel shows the page scaled down a little rather than in a layout nobody tests.
   */
  minWidth: 320,
  minHeight: 240,
  /** 4K-class panels; anything bigger is scaled in the panel, not laid out bigger. */
  maxWidth: 3840,
  maxHeight: 2400,
  /** HiDPI up to 2x: sharp on retina-class screens; 3x phones would mean 2.25x the pixels. */
  maxDeviceScaleFactor: 2,
  /**
   * Upper bound on rendered pixels per frame (2560x1600). Keeps JPEG encode time and frame
   * size bounded on big HiDPI panels; the device scale factor drops (never below 1) to fit.
   */
  maxFramePixels: 2560 * 1600,
} as const;

export const DEFAULT_VIEWPORT: ViewportMetrics = { width: 1280, height: 800, deviceScaleFactor: 1 };

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Clamp a requested viewport to the limits above. */
export function fitViewport(request: {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}): ViewportMetrics {
  const L = VIEWPORT_LIMITS;
  const width = clamp(Math.round(request.width), L.minWidth, L.maxWidth);
  const height = clamp(Math.round(request.height), L.minHeight, L.maxHeight);
  let scale = clamp(request.deviceScaleFactor ?? 1, 1, L.maxDeviceScaleFactor);
  if (width * height * scale * scale > L.maxFramePixels) {
    scale = Math.max(1, Math.sqrt(L.maxFramePixels / (width * height)));
  }
  // Two decimals: stable equality, and Chromium handles fractional factors (1.25, 1.5).
  return { width, height, deviceScaleFactor: Math.floor(scale * 100) / 100 };
}

/**
 * Screencast frame size for a viewport: its device pixels. The pixel budget is applied through
 * the scale factor (`fitViewport`), never below one pixel per CSS pixel: Chromium on macOS
 * stalls and misreports frames scaled below that (see `Screencast.startParams`), so a panel
 * bigger than the budget at 1x gets frames at its CSS size.
 */
export function framePixels(viewport: ViewportMetrics): { width: number; height: number } {
  return {
    width: Math.round(viewport.width * viewport.deviceScaleFactor),
    height: Math.round(viewport.height * viewport.deviceScaleFactor),
  };
}

/** CDP `Emulation.setDeviceMetricsOverride` parameters for a viewport. */
export function deviceMetricsParams(viewport: ViewportMetrics): Record<string, unknown> {
  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  };
}

export function sameViewport(a: ViewportMetrics, b: ViewportMetrics): boolean {
  return (
    a.width === b.width && a.height === b.height && a.deviceScaleFactor === b.deviceScaleFactor
  );
}
