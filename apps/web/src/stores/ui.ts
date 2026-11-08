import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  addProjectOpen: boolean;
  shortcutsOpen: boolean;
  /** The sidebar drawer on phones and tablets. */
  navOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setAddProjectOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setNavOpen: (open: boolean) => void;
}

/** Transient UI state (dialogs, palette). Not persisted. */
export const useUiStore = create<UiState>()((set) => ({
  paletteOpen: false,
  addProjectOpen: false,
  shortcutsOpen: false,
  navOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAddProjectOpen: (addProjectOpen) => set({ addProjectOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setNavOpen: (navOpen) => set({ navOpen }),
}));
