import { useSyncExternalStore } from "react";

/**
 * Responsive layout modes (§13). The desktop layout is unchanged, including narrow desktop
 * windows with a mouse; below it:
 * - phones (< 768 px) and portrait touch tablets (< 1024 px) get the sidebar as a slide-out
 *   drawer;
 * - touch tablets in landscape (1024–1279 px, coarse pointer) keep a slim icon rail;
 * - in both, the right panel opens as an overlay sheet instead of squeezing the transcript.
 */
export interface Viewport {
  /** Narrower than 768 px. */
  phone: boolean;
  /** The sidebar lives in a drawer opened from a menu button. */
  drawerNav: boolean;
  /** The sidebar is shown as the icon rail; expanding it opens the drawer. */
  railNav: boolean;
  /** The right panel opens as an overlay sheet. */
  sheetPanels: boolean;
}

const QUERIES = {
  phone: "(max-width: 767.98px)",
  narrow: "(max-width: 1023.98px)",
  medium: "(max-width: 1279.98px)",
  coarse: "(pointer: coarse)",
} as const;

type Key = keyof typeof QUERIES;

function matches(key: Key): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERIES[key]).matches;
}

function read(): string {
  return (Object.keys(QUERIES) as Key[]).map((k) => (matches(k) ? "1" : "0")).join("");
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
  for (const list of lists) list.addEventListener?.("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener?.("change", onChange);
  };
}

/** Derive the layout modes from the media query results. */
export function viewportFrom(flags: Record<Key, boolean>): Viewport {
  const drawerNav = flags.phone || (flags.narrow && flags.coarse);
  const railNav = !drawerNav && flags.medium && flags.coarse;
  return { phone: flags.phone, drawerNav, railNav, sheetPanels: drawerNav || railNav };
}

/** The current layout modes, updated as the window resizes or rotates. */
export function useViewport(): Viewport {
  const key = useSyncExternalStore(subscribe, read, () => "0000");
  const [phone, narrow, medium, coarse] = [...key].map((c) => c === "1") as boolean[];
  return viewportFrom({
    phone: Boolean(phone),
    narrow: Boolean(narrow),
    medium: Boolean(medium),
    coarse: Boolean(coarse),
  });
}
