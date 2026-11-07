import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  addProjectOpen: boolean;
  shortcutsOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setAddProjectOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
}

/** Transient UI state (dialogs, palette). Not persisted. */
export const useUiStore = create<UiState>()((set) => ({
  paletteOpen: false,
  addProjectOpen: false,
  shortcutsOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAddProjectOpen: (addProjectOpen) => set({ addProjectOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}));
