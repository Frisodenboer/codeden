import { create } from "zustand";

export type FileSelection = { path: string; kind: "file" | "dir" } | null;

/** A dialog of the project file manager (one at a time, shown by the Files page). */
export type FileDialog =
  | { projectId: string; mode: "createFile" | "createDir"; folder: string }
  | { projectId: string; mode: "rename"; path: string; kind: "file" | "dir" }
  | { projectId: string; mode: "delete"; path: string; name: string; kind: "file" | "dir" };

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

interface ExplorerState {
  /** Per project: the selected file or folder and the open folders. */
  selected: Record<string, FileSelection>;
  expanded: Record<string, string[]>;
  /** Per project: whether its file tree is open in the sidebar (under the Files row). */
  treeOpen: Record<string, boolean>;
  dialog: FileDialog | null;
  select: (projectId: string, selection: FileSelection) => void;
  toggleDir: (projectId: string, path: string) => void;
  /** Open every parent folder of `path`. */
  reveal: (projectId: string, path: string) => void;
  setTreeOpen: (projectId: string, open: boolean) => void;
  openDialog: (dialog: FileDialog) => void;
  closeDialog: () => void;
}

/**
 * Shared state of the project file explorer, so the tree in the sidebar and the Files page show
 * the same selection and open folders (like VS Code's explorer and editor).
 */
export const useFileExplorer = create<ExplorerState>()((set) => ({
  selected: {},
  expanded: {},
  treeOpen: {},
  dialog: null,
  select: (projectId, selection) =>
    set((s) => ({ selected: { ...s.selected, [projectId]: selection } })),
  toggleDir: (projectId, path) =>
    set((s) => {
      const open = new Set(s.expanded[projectId] ?? []);
      if (open.has(path)) open.delete(path);
      else open.add(path);
      return { expanded: { ...s.expanded, [projectId]: [...open] } };
    }),
  reveal: (projectId, path) =>
    set((s) => {
      const open = new Set(s.expanded[projectId] ?? []);
      let p = parentOf(path);
      while (p) {
        open.add(p);
        p = parentOf(p);
      }
      return { expanded: { ...s.expanded, [projectId]: [...open] } };
    }),
  setTreeOpen: (projectId, open) =>
    set((s) => ({ treeOpen: { ...s.treeOpen, [projectId]: open } })),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));

export { parentOf };
