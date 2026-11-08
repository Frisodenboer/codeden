/** What the View menu's zoom items ask for. */
export type ZoomCommand = "in" | "out" | "reset";

/** Zoom factors (1 = 100%): 50% to 200% in even 10% steps. */
export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const STEPS_PER_UNIT = 10;

/** Snap a factor to the 10% grid and keep it in range (anything unreadable is 100%). */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return ZOOM_DEFAULT;
  const snapped = Math.round(factor * STEPS_PER_UNIT) / STEPS_PER_UNIT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

/** The factor after one zoom command, one step at a time and never past the limits. */
export function nextZoom(current: number, command: ZoomCommand): number {
  if (command === "reset") return ZOOM_DEFAULT;
  const step = Math.round(clampZoom(current) * STEPS_PER_UNIT) + (command === "in" ? 1 : -1);
  return clampZoom(step / STEPS_PER_UNIT);
}

/** The part of `WebContents` zoom needs (a fake in tests). */
export interface ZoomTarget {
  setZoomFactor(factor: number): void;
  on(event: "did-navigate", listener: () => void): unknown;
}

/**
 * The window's zoom. CodeDen keeps the level itself rather than leaving it to Chromium, whose
 * zoom follows the page's origin (the server's port can change between launches) and isn't
 * remembered across restarts: it starts from the saved factor, applies it again after every
 * full navigation (the launch redirect, a reload, a server restart) and reports each change
 * so the window can save it.
 */
export class WindowZoom {
  private current: number;

  constructor(
    private readonly target: ZoomTarget,
    saved: number | null | undefined,
    private readonly onChange: (factor: number) => void,
  ) {
    this.current = clampZoom(saved ?? ZOOM_DEFAULT);
    target.on("did-navigate", () => target.setZoomFactor(this.current));
  }

  get factor(): number {
    return this.current;
  }

  apply(command: ZoomCommand): void {
    const next = nextZoom(this.current, command);
    this.target.setZoomFactor(next);
    if (next === this.current) return;
    this.current = next;
    this.onChange(next);
  }
}
