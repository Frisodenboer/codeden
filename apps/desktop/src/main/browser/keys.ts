import { NATIVE_BROWSER_APP_SHORTCUTS, type NativeBrowserShortcut } from "@codeden/contracts";

/** The fields of Electron's `before-input-event` input this module reads. */
export interface KeyInput {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export type BrowserKeyAction = "reload" | "hardReload" | "back" | "forward" | "inspect";

/** What a key pressed inside a native view does. */
export type KeyRoute =
  | { kind: "app"; shortcut: NativeBrowserShortcut }
  | { kind: "browser"; action: BrowserKeyAction }
  | null;

/**
 * Keys a focused native view hands elsewhere (§17 Phase 2). A view swallows every key, so:
 * - CodeDen's own shortcuts (`NATIVE_BROWSER_APP_SHORTCUTS`) go to the UI;
 * - the usual browser keys (reload, back/forward, DevTools) act on the view;
 * - everything else, including all plain typing and editing combos, stays in the page.
 */
export function routeKey(input: KeyInput, platform: NodeJS.Platform): KeyRoute {
  if (input.type !== "keyDown") return null;
  const mac = platform === "darwin";
  const mod = mac ? input.meta : input.control;
  const other = mac ? input.control : input.meta;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;

  if (key === "F5")
    return { kind: "browser", action: mod || input.shift ? "hardReload" : "reload" };
  if (mod && !other && !input.alt && key === "r") {
    return { kind: "browser", action: input.shift ? "hardReload" : "reload" };
  }
  if (key === "F12") return { kind: "browser", action: "inspect" };
  if (mod && input.shift && key === "i" && (mac ? input.alt : !input.alt)) {
    return { kind: "browser", action: "inspect" };
  }
  if (!mac && input.alt && !mod && !input.shift && key === "ArrowLeft") {
    return { kind: "browser", action: "back" };
  }
  if (!mac && input.alt && !mod && !input.shift && key === "ArrowRight") {
    return { kind: "browser", action: "forward" };
  }
  if (mac && mod && !input.shift && !input.alt && key === "[")
    return { kind: "browser", action: "back" };
  if (mac && mod && !input.shift && !input.alt && key === "]") {
    return { kind: "browser", action: "forward" };
  }

  if (!mod && !input.alt) return null;
  if (other) return null;
  const combo = comboOf(input, mod, key);
  if (!(NATIVE_BROWSER_APP_SHORTCUTS as readonly string[]).includes(combo)) return null;
  return {
    kind: "app",
    shortcut: {
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      metaKey: input.meta,
      altKey: input.alt,
      shiftKey: input.shift,
    },
  };
}

/** `mod+shift+l`, `alt+1`, `mod+\`: the registry's combo format. */
function comboOf(input: KeyInput, mod: boolean, key: string): string {
  const parts: string[] = [];
  if (mod) parts.push("mod");
  if (input.shift) parts.push("shift");
  if (input.alt) parts.push("alt");
  // With Alt or Shift held, `key` can be another character (Alt+1 is "¡" on macOS): use the
  // physical key for digits and letters.
  const fromCode = /^Digit(\d)$/.exec(input.code)?.[1] ?? /^Key([A-Z])$/.exec(input.code)?.[1];
  parts.push(fromCode ? fromCode.toLowerCase() : key);
  // Registry combos list modifiers as mod, shift, alt in that order but never shift+alt.
  return parts.join("+");
}
