import { join, resolve } from "node:path";
import type { DesktopUpdateState } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, parseLaunchArgs } from "../src/main/args";
import { launchUrl } from "../src/main/connection";
import { appMenuTemplate } from "../src/main/menu";
import { allowPermission, externalUrl, isServerUrl } from "../src/main/security";
import { homeFiles, planServer } from "../src/main/server-plan";
import { trayView } from "../src/main/tray-view";
import { DEFAULT_SIZE, restoreBounds } from "../src/main/window-state";

const idle: DesktopUpdateState = {
  phase: "idle",
  current: "0.1.1",
  latest: null,
  checkedAt: null,
  percent: null,
  error: null,
  unsupported: null,
};

describe("launch arguments", () => {
  it("defaults to the shared ~/.codeden home and no deep link", () => {
    const args = parseLaunchArgs(["."], {}, "/Users/me");
    expect(args).toEqual({
      home: join("/Users/me", ".codeden"),
      port: null,
      hidden: false,
      fake: false,
      deepLink: null,
    });
  });

  it("reads --home, --port, --hidden, --fake and a codeden:// link among Chromium switches", () => {
    const args = parseLaunchArgs(
      [
        "--allow-file-access",
        "--home=/tmp/h",
        "--port",
        "0",
        "--hidden",
        "--fake",
        "codeden://inbox",
      ],
      {},
    );
    expect(args).toMatchObject({
      home: resolve("/tmp/h"),
      port: 0,
      hidden: true,
      fake: true,
      deepLink: "codeden://inbox",
    });
  });

  it("honours CODEDEN_HOME and ignores a bad port", () => {
    const args = parseLaunchArgs(["--port", "99999"], { CODEDEN_HOME: "/data/cd" });
    expect(args.home).toBe(resolve("/data/cd"));
    expect(args.port).toBeNull();
    expect(DEFAULT_PORT).toBe(4317);
  });
});

describe("attach or start (§17)", () => {
  const lock = { pid: 42, port: 4317, version: "0.1.1", startedAt: "2026-11-08T10:00:00.000Z" };
  const deps = (over: Partial<Parameters<typeof planServer>[1]> = {}) => ({
    readLock: () => lock,
    isAlive: () => true,
    healthy: async () => true,
    ...over,
  });

  it("attaches to a live, answering server for the same home", async () => {
    expect(await planServer("/h", deps())).toEqual({ kind: "attach", lock });
  });

  it("starts its own when the lock is missing, stale, dead or not answering", async () => {
    expect(await planServer("/h", deps({ readLock: () => null }))).toEqual({ kind: "start" });
    expect(await planServer("/h", deps({ readLock: () => ({ pid: "x" }) }))).toEqual({
      kind: "start",
    });
    expect(await planServer("/h", deps({ isAlive: () => false }))).toEqual({ kind: "start" });
    expect(await planServer("/h", deps({ healthy: async () => false }))).toEqual({
      kind: "start",
    });
  });

  it("reads the lock where the server writes it and builds the window URL", () => {
    expect(homeFiles("/h").serverLock).toBe(join("/h", "server.json"));
    expect(homeFiles("/h").desktop).toBe(join("/h", "desktop"));
    expect(launchUrl({ url: "http://127.0.0.1:4317", token: "t0k" }, "/sessions/s1")).toBe(
      "http://127.0.0.1:4317/sessions/s1?token=t0k",
    );
  });
});

describe("window security", () => {
  const origin = "http://127.0.0.1:4317";

  it("keeps navigation on the server origin", () => {
    expect(isServerUrl(`${origin}/inbox`, origin)).toBe(true);
    expect(isServerUrl("http://127.0.0.1:4318/", origin)).toBe(false);
    expect(isServerUrl("http://localhost:4317/", origin)).toBe(false);
    expect(isServerUrl("not a url", origin)).toBe(false);
  });

  it("hands only web and mail links to the OS", () => {
    expect(externalUrl("https://github.com/x")).toBe("https://github.com/x");
    expect(externalUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    for (const bad of [
      "file:///C:/Windows/system32/calc.exe",
      "javascript:alert(1)",
      "ms-settings:",
      "x",
    ]) {
      expect(externalUrl(bad), bad).toBeNull();
    }
  });

  it("grants the microphone and notifications to the server's pages only", () => {
    expect(allowPermission("notifications", `${origin}/`, origin)).toBe(true);
    expect(allowPermission("media", `${origin}/`, origin, ["audio"])).toBe(true);
    expect(allowPermission("media", `${origin}/`, origin, ["video"])).toBe(false);
    expect(allowPermission("media", `${origin}/`, origin, [])).toBe(false);
    expect(allowPermission("geolocation", `${origin}/`, origin)).toBe(false);
    expect(allowPermission("notifications", "https://evil.test/", origin)).toBe(false);
  });
});

describe("window bounds", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };

  it("restores saved bounds that are still on a display", () => {
    const saved = { x: 100, y: 80, width: 1200, height: 800, maximized: true };
    expect(restoreBounds(saved, [primary])).toEqual(saved);
  });

  it("falls back to the default size when the monitor is gone, fitted to the display", () => {
    const off = { x: 4000, y: 80, width: 1200, height: 800, maximized: false };
    expect(restoreBounds(off, [primary])).toEqual({ ...DEFAULT_SIZE, maximized: false });
    const small = { x: 0, y: 0, width: 1280, height: 700 };
    expect(restoreBounds(null, [small])).toEqual({ width: 1280, height: 700, maximized: false });
  });
});

describe("tray", () => {
  it("shows running and waiting counts and badges what waits on the user", () => {
    const view = trayView({
      activity: { running: 2, waiting: 1, inbox: 3 },
      connected: true,
      update: idle,
      autoUpdate: false,
    });
    expect(view.lines).toEqual(["2 agents running", "1 waiting on you", "3 items in the inbox"]);
    expect(view.tooltip).toBe("CodeDen (2 running, 1 waiting)");
    expect(view.badge).toBe(3);
    expect(view.update).toBeNull();
  });

  it("says when nothing runs and when the server is unreachable", () => {
    const quiet = trayView({
      activity: { running: 0, waiting: 0, inbox: 0 },
      connected: true,
      update: idle,
      autoUpdate: false,
    });
    expect(quiet.lines).toEqual(["No agents running"]);
    expect(quiet.tooltip).toBe("CodeDen (idle)");
    const down = trayView({ activity: null, connected: false, update: idle, autoUpdate: false });
    expect(down.lines).toEqual(["Not connected to the CodeDen server"]);
    expect(down.badge).toBe(0);
  });

  it("offers the next update step", () => {
    const at = (phase: DesktopUpdateState["phase"], auto = false, percent: number | null = null) =>
      trayView({
        activity: null,
        connected: true,
        update: { ...idle, phase, latest: "0.2.0", percent },
        autoUpdate: auto,
      }).update;
    expect(at("available")).toEqual({ label: "Download CodeDen 0.2.0", command: "download" });
    expect(at("available", true)).toBeNull();
    expect(at("downloading", false, 41.7)).toEqual({
      label: "Downloading CodeDen 0.2.0 (41%)",
      command: null,
    });
    expect(at("downloaded")).toEqual({ label: "Restart to update to 0.2.0", command: "install" });
  });
});

describe("app menu", () => {
  const noop = () => {};
  const actions = {
    openSettings: noop,
    openInbox: noop,
    checkForUpdates: noop,
    openDocs: noop,
    openLogs: noop,
    quit: noop,
    zoom: noop,
  };

  it("has the standard edit, view and window menus on every OS", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const menu = appMenuTemplate(platform, actions);
      expect(menu.some((m) => m.role === "editMenu")).toBe(true);
      expect(menu.some((m) => m.role === "windowMenu")).toBe(true);
      expect(menu.some((m) => m.label === "View")).toBe(true);
    }
  });

  it("puts About, Settings and Quit in the app menu on macOS only", () => {
    expect(appMenuTemplate("darwin", actions)[0]?.label).toBe("CodeDen");
    expect(appMenuTemplate("win32", actions)[0]?.label).toBe("File");
  });
});
