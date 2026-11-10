import type { NativeBrowserBounds } from "@codeden/contracts";

/** A rectangle in window CSS pixels (what `getBoundingClientRect` returns). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the UI layers over the page (§17 Phase 2): every element mounted straight into `body`
 * outside the app (menus, popovers, tooltips, dialogs and the palette all portal there), plus
 * toasts. A native view paints above all of it, so the view hides while one of these overlaps
 * it. A portal that holds the view itself (the panel as a sheet) doesn't count.
 */
export function overlayElements(doc: Document, host: Element): Element[] {
  const out: Element[] = [];
  const root = doc.getElementById("root");
  for (const child of Array.from(doc.body.children)) {
    if (child === root || child.contains(host) || child.tagName === "SCRIPT") continue;
    out.push(child);
  }
  for (const toast of Array.from(doc.querySelectorAll("[data-sonner-toast]"))) out.push(toast);
  return out;
}

/** The boxes an overlay covers: itself, or its children when it is a zero-size wrapper. */
export function overlayRects(elements: readonly Element[]): Rect[] {
  const rects: Rect[] = [];
  for (const el of elements) {
    const own = el.getBoundingClientRect();
    if (own.width > 0 && own.height > 0) {
      rects.push(own);
      continue;
    }
    for (const child of Array.from(el.children)) {
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
  }
  return rects;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** True when any overlay overlaps the view's box. */
export function isOccluded(view: Rect, overlays: readonly Rect[]): boolean {
  return overlays.some((o) => intersects(view, o));
}

/** The panel's box for the bridge, in CSS pixels with fractions kept (the app rounds edges). */
export function toNativeBounds(rect: Rect): NativeBrowserBounds {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) };
}

/** Change detection for placement: the box and the pixel ratio (zoom changes it). */
export function placementKey(rect: Rect, devicePixelRatio: number): string {
  const b = toNativeBounds(rect);
  return `${b.x},${b.y},${b.width},${b.height}@${devicePixelRatio}`;
}
