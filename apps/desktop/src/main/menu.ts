import type { MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  openSettings: () => void;
  openInbox: () => void;
  checkForUpdates: () => void;
  openDocs: () => void;
  openLogs: () => void;
  quit: () => void;
}

/**
 * The application menu with the standard roles (so Cut/Copy/Paste, Undo, zoom, full screen
 * and window shortcuts work as users expect on each OS) plus CodeDen's own entries.
 */
export function appMenuTemplate(
  platform: NodeJS.Platform,
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  const mac = platform === "darwin";
  // No accelerators where the UI already binds the key (Mod+, and Alt+I): the UI handles them.
  const settings: MenuItemConstructorOptions = {
    label: mac ? "Settings..." : "Settings",
    click: actions.openSettings,
  };
  const updates: MenuItemConstructorOptions = {
    label: "Check for Updates...",
    click: actions.checkForUpdates,
  };
  const quit: MenuItemConstructorOptions = {
    label: mac ? "Quit CodeDen" : "Quit",
    accelerator: mac ? "Cmd+Q" : "Ctrl+Q",
    click: actions.quit,
  };
  const template: MenuItemConstructorOptions[] = [];
  if (mac) {
    template.push({
      label: "CodeDen",
      submenu: [
        { role: "about" },
        updates,
        { type: "separator" },
        settings,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        quit,
      ],
    });
  }
  template.push({
    label: "File",
    submenu: [
      { label: "Inbox", click: actions.openInbox },
      ...(mac ? [] : [{ type: "separator" } as const, settings]),
      { type: "separator" },
      mac ? { role: "close" } : quit,
    ],
  });
  template.push({ role: "editMenu" });
  template.push({
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  });
  template.push({ role: "windowMenu" });
  template.push({
    role: "help",
    submenu: [
      { label: "CodeDen Documentation", click: actions.openDocs },
      { label: "Show Logs", click: actions.openLogs },
      ...(mac ? [] : [{ type: "separator" } as const, updates]),
    ],
  });
  return template;
}
