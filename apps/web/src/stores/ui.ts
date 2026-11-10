import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  addProjectOpen: boolean;
  shortcutsOpen: boolean;
  /** The sidebar drawer on phones and tablets. */
  navOpen: boolean;
  /** A native browser view is on screen (toasts move away from it). */
  nativeBrowserShown: boolean;
  setPaletteOpen: (open: boolean) => void;
  setAddProjectOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setNavOpen: (open: boolean) => void;
  setNativeBrowserShown: (shown: boolean) => void;
}

/** Transient UI state (dialogs, palette). Not persisted. */
export const useUiStore = create<UiState>()((set) => ({
  paletteOpen: false,
  addProjectOpen: false,
  shortcutsOpen: false,
  navOpen: false,
  nativeBrowserShown: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAddProjectOpen: (addProjectOpen) => set({ addProjectOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setNavOpen: (navOpen) => set({ navOpen }),
  setNativeBrowserShown: (nativeBrowserShown) => set({ nativeBrowserShown }),
}));
