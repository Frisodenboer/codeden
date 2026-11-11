import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "dark" | "light" | "system";
export type FontStyle = "default" | "terminal";

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
  fontStyle: FontStyle;
  setFontStyle: (fontStyle: FontStyle) => void;
}

/** Resolve `system` against the OS setting. */
export function resolveTheme(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Apply the theme class to `<html>`. */
export function applyTheme(preference: ThemePreference): void {
  document.documentElement.classList.toggle("dark", resolveTheme(preference) === "dark");
}

/** Apply the font style class to `<html>` (terminal = monospace everywhere). */
export function applyFontStyle(fontStyle: FontStyle): void {
  document.documentElement.classList.toggle("font-terminal", fontStyle === "terminal");
}

/** The theme actually applied right now (`system` resolved). */
export function useResolvedTheme(): "dark" | "light" {
  const preference = useThemeStore((s) => s.preference);
  return resolveTheme(preference);
}

/** Theme preference, persisted per browser (dark-first). */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: "dark",
      setPreference: (preference) => set({ preference }),
      toggle: () =>
        set({ preference: resolveTheme(get().preference) === "dark" ? "light" : "dark" }),
      fontStyle: "default",
      setFontStyle: (fontStyle) => set({ fontStyle }),
    }),
    { name: "codeden.theme" },
  ),
);
