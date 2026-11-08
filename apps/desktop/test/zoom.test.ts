import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { afterAll, describe, expect, it } from "vitest";
import { appMenuTemplate } from "../src/main/menu";
import { readWindowState } from "../src/main/window-state";
import {
  clampZoom,
  nextZoom,
  WindowZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  type ZoomCommand,
  type ZoomTarget,
} from "../src/main/zoom";

describe("zoom steps", () => {
  it("steps 10% at a time and resets to 100%", () => {
    expect(nextZoom(1, "in")).toBe(1.1);
    expect(nextZoom(1.1, "in")).toBe(1.2);
    expect(nextZoom(1, "out")).toBe(0.9);
    expect(nextZoom(1.7, "reset")).toBe(1);
  });

  it("lands on the same factors going up and coming back down (no drift)", () => {
    let factor = 1;
    for (let i = 0; i < 7; i++) factor = nextZoom(factor, "in");
    expect(factor).toBe(1.7);
    for (let i = 0; i < 7; i++) factor = nextZoom(factor, "out");
    expect(factor).toBe(1);
  });

  it("stops at 50% and 200%", () => {
    expect(ZOOM_MIN).toBe(0.5);
    expect(ZOOM_MAX).toBe(2);
    expect(nextZoom(2, "in")).toBe(2);
    expect(nextZoom(0.5, "out")).toBe(0.5);
    let factor = 1;
    for (let i = 0; i < 40; i++) factor = nextZoom(factor, "in");
    expect(factor).toBe(2);
    for (let i = 0; i < 40; i++) factor = nextZoom(factor, "out");
    expect(factor).toBe(0.5);
  });

  it("clamps and snaps odd values, and treats junk as 100%", () => {
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.234)).toBe(1.2);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
    // An off-grid factor (e.g. from an older build) steps onto the grid.
    expect(nextZoom(1.15, "in")).toBe(1.3);
  });
});

/** A stand-in for `webContents`: records zoom calls and lets the test fire `did-navigate`. */
function fakeContents() {
  const listeners: Array<() => void> = [];
  const applied: number[] = [];
  const target: ZoomTarget = {
    setZoomFactor: (factor) => applied.push(factor),
    on: (_event, listener) => listeners.push(listener),
  };
  const navigate = () => {
    for (const listener of listeners) listener();
  };
  return { target, applied, navigate };
}

describe("window zoom", () => {
  it("applies the saved factor on every full navigation (load, reload, restart)", () => {
    const contents = fakeContents();
    const zoom = new WindowZoom(contents.target, 1.3, () => {});
    expect(zoom.factor).toBe(1.3);
    contents.navigate();
    contents.navigate();
    expect(contents.applied).toEqual([1.3, 1.3]);
  });

  it("starts at 100% without a saved factor and clamps a saved one", () => {
    expect(new WindowZoom(fakeContents().target, undefined, () => {}).factor).toBe(1);
    expect(new WindowZoom(fakeContents().target, null, () => {}).factor).toBe(1);
    expect(new WindowZoom(fakeContents().target, 9, () => {}).factor).toBe(2);
  });

  it("zooms the page, reports changes for saving and keeps the level across navigations", () => {
    const contents = fakeContents();
    const saved: number[] = [];
    const zoom = new WindowZoom(contents.target, 1, (f) => saved.push(f));
    zoom.apply("in");
    zoom.apply("in");
    expect(contents.applied).toEqual([1.1, 1.2]);
    expect(saved).toEqual([1.1, 1.2]);
    contents.navigate();
    expect(contents.applied.at(-1)).toBe(1.2);
    zoom.apply("reset");
    expect(zoom.factor).toBe(1);
    expect(saved.at(-1)).toBe(1);
  });

  it("doesn't save again at a limit", () => {
    const saved: number[] = [];
    const zoom = new WindowZoom(fakeContents().target, 2, (f) => saved.push(f));
    zoom.apply("in");
    expect(zoom.factor).toBe(2);
    expect(saved).toEqual([]);
  });
});

describe("saved zoom", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeden-zoom-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const read = (state: object) => {
    const file = join(dir, "window-state.json");
    writeFileSync(file, JSON.stringify(state));
    return readWindowState(file);
  };
  const bounds = { x: 10, y: 20, width: 1200, height: 800, maximized: false };

  it("reads the zoom saved with the window state", () => {
    expect(read({ ...bounds, zoomFactor: 1.4 })).toEqual({ ...bounds, zoomFactor: 1.4 });
  });

  it("keeps the bounds of older files without a zoom, at 100%", () => {
    expect(read(bounds)).toEqual({ ...bounds, zoomFactor: 1 });
  });

  it("clamps an out-of-range zoom and ignores a broken one rather than dropping the bounds", () => {
    expect(read({ ...bounds, zoomFactor: 7 })?.zoomFactor).toBe(2);
    expect(read({ ...bounds, zoomFactor: 0.05 })?.zoomFactor).toBe(0.5);
    expect(read({ ...bounds, zoomFactor: "big" })).toEqual({ ...bounds, zoomFactor: 1 });
  });
});

describe("zoom menu items", () => {
  const actionsFor = (calls: ZoomCommand[]) => ({
    openSettings: () => {},
    openInbox: () => {},
    checkForUpdates: () => {},
    openDocs: () => {},
    openLogs: () => {},
    quit: () => {},
    zoom: (command: ZoomCommand) => calls.push(command),
  });
  const viewItems = (platform: NodeJS.Platform, calls: ZoomCommand[] = []) => {
    const view = appMenuTemplate(platform, actionsFor(calls)).find((m) => m.label === "View");
    return (view?.submenu ?? []) as MenuItemConstructorOptions[];
  };
  /** Press an item's accelerator: run its click handler as Electron would. */
  const press = (items: MenuItemConstructorOptions[], accelerator: string) => {
    const item = items.find((i) => i.accelerator === accelerator);
    if (!item?.click) throw new Error(`no menu item for ${accelerator}`);
    (item.click as () => void)();
  };

  for (const platform of ["win32", "darwin", "linux"] as const) {
    it(`binds every usual zoom key on ${platform}`, () => {
      const calls: ZoomCommand[] = [];
      const items = viewItems(platform, calls);
      for (const key of [
        "CommandOrControl+=",
        "CommandOrControl+Plus",
        "CommandOrControl+numadd",
        "CommandOrControl+-",
        "CommandOrControl+_",
        "CommandOrControl+numsub",
        "CommandOrControl+0",
        "CommandOrControl+num0",
      ]) {
        press(items, key);
      }
      expect(calls).toEqual(["in", "in", "in", "out", "out", "out", "reset", "reset"]);
    });
  }

  it("shows Actual Size, Zoom In (Ctrl+=) and Zoom Out, and hides the extra keys", () => {
    const items = viewItems("win32");
    const visible = items.filter((i) => i.accelerator && i.visible !== false);
    expect(visible.map((i) => [i.label, i.accelerator])).toEqual([
      ["Actual Size", "CommandOrControl+0"],
      ["Zoom In", "CommandOrControl+="],
      ["Zoom Out", "CommandOrControl+-"],
    ]);
    const hidden = items.filter((i) => i.visible === false);
    expect(hidden).toHaveLength(5);
    for (const item of hidden) expect(item.acceleratorWorksWhenHidden).toBe(true);
  });

  it("doesn't use the built-in zoom roles (their Zoom In key is Ctrl+Shift+=)", () => {
    const roles = viewItems("win32").map((i) => i.role);
    expect(roles).not.toContain("zoomIn");
    expect(roles).not.toContain("zoomOut");
    expect(roles).not.toContain("resetZoom");
  });
});
