import type { MenuItemConstructorOptions } from "electron";

/** The parts of Electron's `context-menu` params the menu reads. */
export interface MenuParams {
  linkURL: string;
  srcURL: string;
  mediaType: string;
  selectionText: string;
  isEditable: boolean;
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

export interface MenuActions {
  canGoBack: boolean;
  canGoForward: boolean;
  back(): void;
  forward(): void;
  reload(): void;
  openInNewTab(url: string): void;
  copyText(text: string): void;
  inspect(x: number, y: number): void;
}

/**
 * The right-click menu of a native browser view (§17 Phase 2): what a browser offers for a
 * link, an image, a selection or a text field, then navigation and Inspect. Copy and paste use
 * Electron's roles, so they act on the page itself.
 */
export function contextMenuTemplate(
  params: MenuParams,
  at: { x: number; y: number },
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const section = (more: MenuItemConstructorOptions[]) => {
    if (more.length === 0) return;
    if (items.length > 0) items.push({ type: "separator" });
    items.push(...more);
  };
  if (/^https?:/i.test(params.linkURL)) {
    section([
      { label: "Open link in new tab", click: () => actions.openInNewTab(params.linkURL) },
      { label: "Copy link address", click: () => actions.copyText(params.linkURL) },
    ]);
  }
  if (params.mediaType === "image" && /^(https?|data):/i.test(params.srcURL)) {
    section([{ label: "Copy image address", click: () => actions.copyText(params.srcURL) }]);
  }
  if (params.isEditable) {
    const f = params.editFlags;
    section([
      { role: "undo", enabled: f.canUndo },
      { role: "redo", enabled: f.canRedo },
      { type: "separator" },
      { role: "cut", enabled: f.canCut },
      { role: "copy", enabled: f.canCopy },
      { role: "paste", enabled: f.canPaste },
      { role: "selectAll", enabled: f.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) {
    section([{ role: "copy" }]);
  }
  section([
    { label: "Back", enabled: actions.canGoBack, click: () => actions.back() },
    { label: "Forward", enabled: actions.canGoForward, click: () => actions.forward() },
    { label: "Reload", click: () => actions.reload() },
  ]);
  section([{ label: "Inspect", click: () => actions.inspect(at.x, at.y) }]);
  return items;
}
