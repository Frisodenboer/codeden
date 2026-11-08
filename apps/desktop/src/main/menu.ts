import type { MenuItemConstructorOptions } from "electron";
import type { ZoomCommand } from "./zoom";

export interface MenuActions {
  openSettings: () => void;
  openInbox: () => void;
  checkForUpdates: () => void;
  openDocs: () => void;
  openLogs: () => void;
  quit: () => void;
  zoom: (command: ZoomCommand) => void;
}

/**
 * The zoom items. The visible ones carry the unshifted keys (Ctrl+= on Windows and Linux,
 * Cmd+= on macOS, where "+" usually needs Shift); hidden twins add Ctrl+Shift+= ("Plus"),
 * Ctrl+Shift+- and the numpad keys. Accelerators fire for hidden items on every OS, and
 * whether or not the menu bar is showing.
 */
function zoomItems(zoom: MenuActions["zoom"]): MenuItemConstructorOptions[] {
  const item = (label: string, command: ZoomCommand, accelerator: string, visible = true) => ({
    label,
    accelerator,
    click: () => zoom(command),
    ...(visible ? {} : { visible: false, acceleratorWorksWhenHidden: true }),
  });
  return [
    item("Actual Size", "reset", "CommandOrControl+0"),
    item("Zoom In", "in", "CommandOrControl+="),
    item("Zoom Out", "out", "CommandOrControl+-"),
    item("Actual Size", "reset", "CommandOrControl+num0", false),
    item("Zoom In", "in", "CommandOrControl+Plus", false),
    item("Zoom In", "in", "CommandOrControl+numadd", false),
    item("Zoom Out", "out", "CommandOrControl+_", false),
    item("Zoom Out", "out", "CommandOrControl+numsub", false),
  ];
}

/**
 * The application menu with the standard roles (so Cut/Copy/Paste, Undo, full screen and
 * window shortcuts work as users expect on each OS) plus CodeDen's own entries, including
 * zoom (remembered with the window, see `WindowZoom`).
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
      ...zoomItems(actions.zoom),
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
