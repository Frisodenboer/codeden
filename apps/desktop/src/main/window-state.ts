import { readFileSync } from "node:fs";
import { z } from "zod";
import { clampZoom, ZOOM_DEFAULT } from "./zoom";

/** The window's saved position, size and zoom (`<home>/desktop/window-state.json`). */
export const WindowState = z.object({
  x: z.int(),
  y: z.int(),
  width: z.int().min(400),
  height: z.int().min(300),
  maximized: z.boolean().default(false),
  /** Zoom factor (1 = 100%); missing (older files) or unreadable is 100%, never a lost window. */
  zoomFactor: z.number().catch(ZOOM_DEFAULT).transform(clampZoom),
});
export type WindowState = z.infer<typeof WindowState>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN_VISIBLE = 120;

/**
 * Where to open the window: the saved bounds when enough of the title bar is still on one of
 * the displays (monitors change), clamped to that display's size; otherwise the default size
 * centred on the primary display (`x`/`y` undefined lets Electron centre it).
 */
export function restoreBounds(
  saved: (Rect & { maximized: boolean }) | null,
  displays: readonly Rect[],
): { x?: number; y?: number; width: number; height: number; maximized: boolean } {
  const primary = displays[0];
  const fit = (size: { width: number; height: number }, area?: Rect) => ({
    width: Math.min(size.width, area?.width ?? size.width),
    height: Math.min(size.height, area?.height ?? size.height),
  });
  if (saved) {
    const home = displays.find((d) => visibleOverlap(saved, d) >= MIN_VISIBLE);
    if (home) {
      return { x: saved.x, y: saved.y, ...fit(saved, home), maximized: saved.maximized };
    }
  }
  return { ...fit(DEFAULT_SIZE, primary), maximized: saved?.maximized ?? false };
}

/** Horizontal overlap of the window's title bar strip with a display, in pixels. */
function visibleOverlap(win: Rect, display: Rect): number {
  const titleY = win.y + 10;
  if (titleY < display.y || titleY > display.y + display.height) return 0;
  const left = Math.max(win.x, display.x);
  const right = Math.min(win.x + win.width, display.x + display.width);
  return Math.max(0, right - left);
}

export function readWindowState(file: string): WindowState | null {
  try {
    const parsed = WindowState.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
