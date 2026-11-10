import type { BrowserInput, BrowserKeyInput, BrowserMouseInput } from "@codeden/contracts";
import type { CDPSession } from "playwright-core";

/** Page viewport in CSS pixels, the target space for mapped pointer coordinates. */
export interface ViewportSize {
  width: number;
  height: number;
}

type MouseButton = "none" | "left" | "middle" | "right";

const BUTTON_BITS: Record<MouseButton, number> = { none: 0, left: 1, right: 2, middle: 4 };

const MOUSE_TYPES = {
  "mouse.move": "mouseMoved",
  "mouse.down": "mousePressed",
  "mouse.up": "mouseReleased",
  "mouse.wheel": "mouseWheel",
} as const;

/** Windows virtual key codes Chromium needs for default actions of non-printable keys. */
const VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  Meta: 91,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
};

const KEY_TEXT: Record<string, string> = { Enter: "\r", Tab: "\t", " ": " " };

/** Largest wheel delta forwarded per event (CSS pixels): no page-long jumps from one flick. */
export const MAX_WHEEL_DELTA = 1200;

/**
 * Map a point in the displayed frame onto the page viewport (CSS pixels), clamped. The frame
 * covers the viewport it was captured at (`viewportWidth`/`viewportHeight` from its metadata
 * when the panel sends them, else `viewport`); the result is clamped to the current `viewport`.
 */
export function mapPoint(
  input: Pick<
    BrowserMouseInput,
    "x" | "y" | "frameWidth" | "frameHeight" | "viewportWidth" | "viewportHeight"
  >,
  viewport: ViewportSize,
): { x: number; y: number } {
  const x = (input.x / input.frameWidth) * (input.viewportWidth ?? viewport.width);
  const y = (input.y / input.frameHeight) * (input.viewportHeight ?? viewport.height);
  return {
    x: Math.min(Math.max(x, 0), viewport.width - 1),
    y: Math.min(Math.max(y, 0), viewport.height - 1),
  };
}

const clampWheel = (delta: number | undefined) =>
  Math.min(Math.max(delta ?? 0, -MAX_WHEEL_DELTA), MAX_WHEEL_DELTA);

/** Windows virtual key code for a DOM key (letters and digits map to their char code). */
export function virtualKeyCode(key: string): number | undefined {
  const known = VIRTUAL_KEYS[key];
  if (known !== undefined) return known;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  return undefined;
}

/** CDP `Input.dispatchKeyEvent` parameters for a key input. */
export function keyEventParams(input: BrowserKeyInput): Record<string, unknown> {
  const text =
    input.text ?? KEY_TEXT[input.key] ?? (input.key.length === 1 ? input.key : undefined);
  const vk = virtualKeyCode(input.key);
  const base = {
    key: input.key,
    ...(input.code ? { code: input.code } : {}),
    ...(vk !== undefined ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
    modifiers: input.modifiers ?? 0,
  };
  // Shortcuts (Ctrl/Meta held) must not insert text.
  const typing = text !== undefined && ((input.modifiers ?? 0) & (2 | 4)) === 0;
  switch (input.type) {
    case "key.down":
      return typing
        ? { ...base, type: "keyDown", text, unmodifiedText: text }
        : { ...base, type: "rawKeyDown" };
    case "key.up":
      return { ...base, type: "keyUp" };
    case "key.char":
      return { ...base, type: "char", text: text ?? input.key, unmodifiedText: text ?? input.key };
  }
}

/**
 * Forwards panel input to a tab through CDP `Input.dispatch*`, tracking held mouse buttons
 * so drags report the right `buttons` state.
 */
export class InputForwarder {
  private buttons = 0;

  /** CDP `Input.dispatchMouseEvent` parameters (exposed for tests). */
  mouseEventParams(input: BrowserMouseInput, viewport: ViewportSize): Record<string, unknown> {
    const { x, y } = mapPoint(input, viewport);
    const button: MouseButton = input.button ?? (input.type === "mouse.move" ? "none" : "left");
    if (input.type === "mouse.down") this.buttons |= BUTTON_BITS[button];
    if (input.type === "mouse.up") this.buttons &= ~BUTTON_BITS[button];
    const params: Record<string, unknown> = {
      type: MOUSE_TYPES[input.type],
      x,
      y,
      modifiers: input.modifiers ?? 0,
      button: input.type === "mouse.wheel" ? "none" : button,
      buttons: this.buttons,
    };
    if (input.type === "mouse.down" || input.type === "mouse.up") {
      params.clickCount = input.clickCount ?? 1;
    }
    if (input.type === "mouse.wheel") {
      params.deltaX = clampWheel(input.deltaX);
      params.deltaY = clampWheel(input.deltaY);
    }
    return params;
  }

  async dispatch(cdp: CDPSession, input: BrowserInput, viewport: ViewportSize): Promise<void> {
    switch (input.type) {
      case "mouse.move":
      case "mouse.down":
      case "mouse.up":
      case "mouse.wheel":
        await cdp.send("Input.dispatchMouseEvent", this.mouseEventParams(input, viewport) as never);
        return;
      case "key.down":
      case "key.up":
      case "key.char":
        await cdp.send("Input.dispatchKeyEvent", keyEventParams(input) as never);
        return;
      case "text.insert":
        await cdp.send("Input.insertText", { text: input.text });
        return;
    }
  }
}
