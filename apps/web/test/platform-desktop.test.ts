import type { CodedenDesktopApi, DesktopNotification } from "@codeden/contracts";
import { describe, expect, it, vi } from "vitest";
import { updateModeHelp } from "@/components/settings/update-mode";
import { canUpdate } from "@/components/shell/update-banner";
import { selectPlatform } from "@/lib/platform";

/** A stand-in for the desktop app's preload bridge. */
function fakeDesktop() {
  const clickListeners: Array<(tag: string) => void> = [];
  const navigateListeners: Array<(path: string) => void> = [];
  const notified: DesktopNotification[] = [];
  const api: CodedenDesktopApi = {
    info: async () => ({
      version: "0.1.1",
      platform: "win32",
      packaged: true,
      ownsServer: true,
      launchAtLoginSupported: true,
    }),
    pickFolder: vi.fn(async () => "C:\\Users\\me\\code\\app"),
    notify: (n) => notified.push(n),
    onNotificationClick: (l) => {
      clickListeners.push(l);
      return () => {};
    },
    openExternal: vi.fn(),
    setBadge: vi.fn(),
    onNavigate: (l) => {
      navigateListeners.push(l);
      return () => {};
    },
  };
  return {
    api,
    notified,
    click: (tag: string) => {
      for (const l of clickListeners) l(tag);
    },
    navigate: (path: string) => {
      for (const l of navigateListeners) l(path);
    },
  };
}

describe("platform selection (§13)", () => {
  it("uses the web bridge without the desktop preload", async () => {
    const web = selectPlatform({});
    expect(web.capabilities.folderPicker).toBe(false);
    expect(web.capabilities.osIntegration).toBe(false);
    expect(await web.pickFolder()).toBeNull();
    expect(await web.launchAtLoginSupported()).toBe(false);
  });

  it("detects the desktop bridge by feature and routes through it", async () => {
    const desktop = fakeDesktop();
    const p = selectPlatform({ codedenDesktop: desktop.api });
    expect(p.capabilities).toMatchObject({
      folderPicker: true,
      osIntegration: true,
      notifications: true,
      badge: true,
    });
    expect(p.notificationPermission()).toBe("granted");
    expect(await p.pickFolder({ title: "Pick" })).toBe("C:\\Users\\me\\code\\app");
    expect(desktop.api.pickFolder).toHaveBeenCalledWith({ title: "Pick" });
    p.setBadge(3);
    expect(desktop.api.setBadge).toHaveBeenCalledWith(3);
    p.openExternal("https://github.com/leonvanzyl/codeden");
    expect(desktop.api.openExternal).toHaveBeenCalledWith("https://github.com/leonvanzyl/codeden");
    expect(await p.launchAtLoginSupported()).toBe(true);
  });

  it("runs a notification's click handler once, by tag", () => {
    const desktop = fakeDesktop();
    const p = selectPlatform({ codedenDesktop: desktop.api });
    const onClick = vi.fn();
    p.notify("Approval needed", { body: "git push --force", tag: "inbox-1", onClick });
    p.notify("No handler", {});
    expect(desktop.notified[0]).toEqual({
      title: "Approval needed",
      body: "git push --force",
      tag: "inbox-1",
    });
    expect(desktop.notified[1]?.tag).toMatch(/^n\d+$/);
    desktop.click("inbox-1");
    desktop.click("inbox-1");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("passes codeden:// navigation on to the UI", () => {
    const desktop = fakeDesktop();
    const p = selectPlatform({ codedenDesktop: desktop.api });
    const seen: string[] = [];
    p.onNavigate((path) => seen.push(path));
    desktop.navigate("/sessions/s1");
    expect(seen).toEqual(["/sessions/s1"]);
  });
});

describe("desktop updates in the UI (§17)", () => {
  it("lets the desktop app install updates and says where they come from", () => {
    expect(canUpdate({ source: "desktop" } as never)).toBe(true);
    expect(canUpdate({ source: "packaged" } as never)).toBe(true);
    expect(canUpdate({ source: "source" } as never)).toBe(false);
    expect(updateModeHelp("notify", "desktop")).toContain("GitHub Releases");
    expect(updateModeHelp("notify", "packaged")).toContain("npm registry");
  });
});
