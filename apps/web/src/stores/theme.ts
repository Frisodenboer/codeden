import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "dark" | "light" | "system";

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
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
    }),
    { name: "codeden.theme" },
  ),
);
