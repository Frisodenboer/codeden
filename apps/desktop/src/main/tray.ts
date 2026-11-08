import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import type { TrayView } from "./tray-view";

export interface TrayActions {
  open: () => void;
  openInbox: () => void;
  update: (command: "download" | "install") => void;
  quit: () => void;
}

/**
 * The tray (Windows, Linux) or menu bar (macOS) icon: running and waiting counts in the
 * tooltip and menu, Open, the inbox, the update step when one is due, and Quit.
 */
export class AppTray {
  private readonly tray: Tray;
  private view: TrayView | null = null;

  constructor(
    icon: string,
    private readonly actions: TrayActions,
  ) {
    const image = nativeImage.createFromPath(icon);
    if (process.platform === "darwin") image.setTemplateImage(true);
    this.tray = new Tray(image);
    this.tray.setToolTip("CodeDen");
    // A click opens the window on Windows and Linux; macOS shows the menu (the convention).
    if (process.platform !== "darwin") this.tray.on("click", () => actions.open());
    this.render();
  }

  update(view: TrayView): void {
    const same = JSON.stringify(view) === JSON.stringify(this.view);
    this.view = view;
    if (!same) this.render();
  }

  /** The menu as it is now (the smoke test reads it). */
  menuLabels(): string[] {
    return this.template()
      .map((item) => item.label)
      .filter((label): label is string => Boolean(label));
  }

  destroy(): void {
    this.tray.destroy();
  }

  private render(): void {
    if (this.view) this.tray.setToolTip(this.view.tooltip);
    this.tray.setContextMenu(Menu.buildFromTemplate(this.template()));
  }

  private template(): MenuItemConstructorOptions[] {
    const view = this.view;
    const items: MenuItemConstructorOptions[] = [];
    for (const line of view?.lines ?? ["Starting..."]) items.push({ label: line, enabled: false });
    items.push({ type: "separator" });
    items.push({ label: "Open CodeDen", click: () => this.actions.open() });
    items.push({ label: "Open the inbox", click: () => this.actions.openInbox() });
    const update = view?.update;
    if (update) {
      items.push({ type: "separator" });
      items.push({
        label: update.label,
        enabled: update.command !== null,
        click: () => update.command && this.actions.update(update.command),
      });
    }
    items.push({ type: "separator" });
    items.push({ label: "Quit CodeDen", click: () => this.actions.quit() });
    return items;
  }
}
