import type { NativeBrowserBounds } from "@codeden/contracts";

/** A view rectangle in window content coordinates (DIPs), whole pixels. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a view sits until a panel has been measured: off the panel, at a common laptop size. */
export const DEFAULT_VIEW_SIZE = { width: 1280, height: 800 } as const;

/**
 * Place a view over the panel (§17 Phase 2). The UI measures its content box in CSS pixels;
 * the window's zoom (50% to 200%, View menu) scales CSS pixels to DIPs. Edges are rounded
 * independently so neighbouring edges stay flush at fractional zoom levels, and the rectangle
 * is clipped to the window's content area. Returns null when nothing is left to show.
 */
export function toViewRect(
  css: NativeBrowserBounds,
  zoomFactor: number,
  content: { width: number; height: number },
): ViewRect | null {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const left = clamp(Math.round(css.x * zoom), 0, content.width);
  const top = clamp(Math.round(css.y * zoom), 0, content.height);
  const right = clamp(Math.round((css.x + css.width) * zoom), 0, content.width);
  const bottom = clamp(Math.round((css.y + css.height) * zoom), 0, content.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;
  return { x: left, y: top, width, height };
}

export function sameRect(a: ViewRect | null | undefined, b: ViewRect | null | undefined): boolean {
  return a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
