import type { BrowserInput } from "@codeden/contracts";

/** CDP modifier bitmask: Alt = 1, Ctrl = 2, Meta = 4, Shift = 8. */
export function modifiersOf(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const BUTTONS = ["left", "middle", "right"] as const;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameBox {
  /** Where the frame is drawn on screen (see `frameRect`). */
  rect: Rect;
  /** Size of the frame as drawn (the screencast frame's own pixels). */
  frameWidth: number;
  frameHeight: number;
  /** Page viewport (CSS pixels) the frame shows, from its metadata. */
  viewportWidth?: number;
  viewportHeight?: number;
}

/** How a frame is drawn in the panel: stretched to the box, or fitted inside it. */
export type FrameFit = "fill" | "contain";

/**
 * Where a `frameWidth` x `frameHeight` frame lands inside `box`: the whole box for `fill`,
 * the centred letterboxed rectangle for `contain` (CSS `object-fit`).
 */
export function frameRect(box: Rect, frameWidth: number, frameHeight: number, fit: FrameFit): Rect {
  if (fit === "fill" || frameWidth <= 0 || frameHeight <= 0) return box;
  const scale = Math.min(box.width / frameWidth, box.height / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/** True when a client point falls on the drawn frame. */
export function onFrame(rect: Rect, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.left + rect.width &&
    clientY >= rect.top &&
    clientY <= rect.top + rect.height
  );
}

/** Chromium's pixels per wheel "line" (Firefox reports lines). */
const LINE_PX = 40;

/**
 * Wheel deltas in page CSS pixels: line and page modes become pixels, and panel pixels are
 * scaled by how big the page is drawn, so content moves under the pointer at the speed of the
 * gesture whatever the zoom.
 */
export function wheelDeltas(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  box: FrameBox,
): { deltaX: number; deltaY: number } {
  const pageHeight = box.viewportHeight ?? box.rect.height;
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageHeight * 0.875 : 1;
  const scaleX = (box.viewportWidth ?? box.rect.width) / Math.max(box.rect.width, 1);
  const scaleY = pageHeight / Math.max(box.rect.height, 1);
  return { deltaX: e.deltaX * unit * scaleX, deltaY: e.deltaY * unit * scaleY };
}

/**
 * A pointer event on the displayed frame as panel input: coordinates are mapped from the
 * frame's on-screen box into frame pixels (the runner maps those onto the page viewport).
 */
export function mouseInput(
  type: "mouse.move" | "mouse.down" | "mouse.up" | "mouse.wheel",
  e: {
    clientX: number;
    clientY: number;
    button?: number;
    detail?: number;
    deltaX?: number;
    deltaY?: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  box: FrameBox,
): BrowserInput {
  const { rect, frameWidth, frameHeight, viewportWidth, viewportHeight } = box;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x = clamp(((e.clientX - rect.left) / Math.max(rect.width, 1)) * frameWidth, frameWidth);
  const y = clamp(((e.clientY - rect.top) / Math.max(rect.height, 1)) * frameHeight, frameHeight);
  const base = {
    type,
    x,
    y,
    frameWidth,
    frameHeight,
    ...(viewportWidth && viewportHeight ? { viewportWidth, viewportHeight } : {}),
    modifiers: modifiersOf(e),
  };
  if (type === "mouse.wheel") return { ...base, deltaX: e.deltaX ?? 0, deltaY: e.deltaY ?? 0 };
  if (type === "mouse.move") return { ...base, button: "none" };
  return {
    ...base,
    button: BUTTONS[e.button ?? 0] ?? "left",
    clickCount: Math.min(Math.max(e.detail ?? 1, 1), 3),
  };
}

/** A key event as panel input; printable keys carry their text (shortcuts never type). */
export function keyInput(
  type: "key.down" | "key.up",
  e: {
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
): BrowserInput | null {
  if (!e.key || e.key === "Unidentified" || e.key.length > 40) return null;
  const printable = e.key.length === 1;
  return {
    type,
    key: e.key,
    code: e.code || undefined,
    text: printable && type === "key.down" ? e.key : undefined,
    modifiers: modifiersOf(e),
  };
}

/**
 * Fixed viewport presets (CSS pixels). By default the page follows the panel's own size;
 * a preset lays it out at a device size and fits the frame inside the panel.
 */
export const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: 1280, height: 800 },
  { id: "laptop", label: "Laptop", width: 1440, height: 900 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "mobile", label: "Mobile", width: 390, height: 844 },
] as const;
