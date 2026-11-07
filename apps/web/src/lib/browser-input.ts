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

export interface FrameBox {
  /** The element's bounding box on screen. */
  rect: { left: number; top: number; width: number; height: number };
  /** Size of the frame as drawn (the screencast frame's own pixels). */
  frameWidth: number;
  frameHeight: number;
}

/**
 * A pointer event on the displayed frame as panel input: coordinates are mapped from the
 * element's on-screen box into frame pixels (the runner maps those onto the page viewport).
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
  const { rect, frameWidth, frameHeight } = box;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x = clamp(((e.clientX - rect.left) / Math.max(rect.width, 1)) * frameWidth, frameWidth);
  const y = clamp(((e.clientY - rect.top) / Math.max(rect.height, 1)) * frameHeight, frameHeight);
  const base = { type, x, y, frameWidth, frameHeight, modifiers: modifiersOf(e) };
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

/** Viewport presets for the panel (CSS pixels). */
export const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: 1280, height: 800 },
  { id: "laptop", label: "Laptop", width: 1440, height: 900 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "mobile", label: "Mobile", width: 390, height: 844 },
] as const;
