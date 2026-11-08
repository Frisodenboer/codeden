import type { DesktopHostMessage, DesktopServerMessage } from "@codeden/contracts";
import { describe, expect, it, vi } from "vitest";
import { ActivityMonitor } from "../src/main/activity";
import { UpdateController, type Updater } from "../src/main/updates/controller";
import { quitAction, SIX_HOURS, standaloneAction, updateSupport } from "../src/main/updates/policy";
import { IpcDesktopUpdater } from "../src/server/update-bridge";

/** A scripted electron-updater. */
function fakeUpdater(latest = "0.2.0") {
  let progress: ((info: { percent: number }) => void) | undefined;
  const calls: string[] = [];
  const updater: Updater & { failDownload?: boolean } = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: (_event, listener) => {
      progress = listener;
    },
    async checkForUpdates() {
      calls.push("check");
      return { updateInfo: { version: latest } };
    },
    async downloadUpdate() {
      calls.push("download");
      progress?.({ percent: 50 });
      if (updater.failDownload) throw new Error("net::ERR_INTERNET_DISCONNECTED\nstack");
      return [];
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      calls.push(`quitAndInstall:${isSilent}:${isForceRunAfter}`);
    },
  };
  return { updater, calls };
}

describe("update policy", () => {
  it("only installed builds update, and on macOS only signed ones", () => {
    expect(updateSupport({ packaged: false, platform: "win32", macSigned: false })).toMatch(
      /installed builds/,
    );
    expect(updateSupport({ packaged: true, platform: "win32", macSigned: false })).toBeNull();
    expect(updateSupport({ packaged: true, platform: "linux", macSigned: false })).toBeNull();
    expect(updateSupport({ packaged: true, platform: "darwin", macSigned: false })).toMatch(
      /not signed/,
    );
    expect(updateSupport({ packaged: true, platform: "darwin", macSigned: true })).toBeNull();
  });

  it("checks on launch and every 6 hours, never when off", () => {
    const base = { phase: "idle" as const, unsupported: null, now: 10 * SIX_HOURS };
    expect(standaloneAction({ ...base, mode: "notify", checkedAt: null })).toBe("check");
    expect(standaloneAction({ ...base, mode: "notify", checkedAt: base.now - 1000 })).toBeNull();
    expect(standaloneAction({ ...base, mode: "notify", checkedAt: base.now - SIX_HOURS })).toBe(
      "check",
    );
    expect(standaloneAction({ ...base, mode: "off", checkedAt: null })).toBeNull();
    expect(
      standaloneAction({ ...base, mode: "auto", checkedAt: null, unsupported: "unsigned" }),
    ).toBeNull();
  });

  it("downloads found updates in auto mode only, and never twice at once", () => {
    const at = { unsupported: null, checkedAt: 0, now: 1 };
    expect(standaloneAction({ ...at, mode: "auto", phase: "available" })).toBe("download");
    expect(standaloneAction({ ...at, mode: "notify", phase: "available" })).toBeNull();
    for (const phase of ["checking", "downloading", "downloaded", "installing"] as const) {
      expect(standaloneAction({ ...at, mode: "auto", phase, checkedAt: null })).toBeNull();
    }
  });

  it("installs a downloaded update on quit, else just quits", () => {
    expect(quitAction("downloaded")).toBe("install");
    expect(quitAction("available")).toBe("quit");
    expect(quitAction("idle")).toBe("quit");
  });
});

describe("update controller", () => {
  const make = (latest = "0.2.0", unsupported: string | null = null) => {
    const { updater, calls } = fakeUpdater(latest);
    const beforeInstall = vi.fn(async () => {
      calls.push("beforeInstall");
    });
    const controller = new UpdateController({
      current: "0.1.1",
      unsupported,
      updater: () => updater,
      beforeInstall,
      now: () => Date.parse("2026-11-08T10:00:00.000Z"),
    });
    return { controller, updater, calls, beforeInstall };
  };

  it("takes over electron-updater's automatic download and install-on-quit", async () => {
    const { controller, updater } = make();
    await controller.run("check");
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(controller.state).toMatchObject({
      phase: "available",
      latest: "0.2.0",
      checkedAt: "2026-11-08T10:00:00.000Z",
    });
  });

  it("reports no update when the latest release is the running version", async () => {
    const { controller } = make("0.1.1");
    await controller.run("check");
    expect(controller.state.phase).toBe("idle");
    await controller.run("download");
    expect(controller.state.phase).toBe("idle");
  });

  it("downloads with progress, then stops the runner before installing", async () => {
    const { controller, calls } = make();
    const percents: Array<number | null> = [];
    controller.onChange((s) => percents.push(s.percent));
    await controller.run("download");
    expect(percents).toContain(50);
    expect(controller.state.phase).toBe("downloaded");
    await controller.run("install");
    expect(calls).toEqual(["check", "download", "beforeInstall", "quitAndInstall:true:true"]);
    expect(controller.state.phase).toBe("installing");
  });

  it("installs on quit without starting the app again", async () => {
    const { controller, calls } = make();
    await controller.run("download");
    await controller.installOnQuit();
    expect(calls.slice(-2)).toEqual(["beforeInstall", "quitAndInstall:true:false"]);
  });

  it("records a failed download (first line only) and can retry", async () => {
    const { controller, updater } = make();
    updater.failDownload = true;
    await expect(controller.run("download")).rejects.toThrow("net::ERR_INTERNET_DISCONNECTED");
    expect(controller.state).toMatchObject({
      phase: "error",
      error: "net::ERR_INTERNET_DISCONNECTED",
    });
    updater.failDownload = false;
    await controller.run("download");
    expect(controller.state.phase).toBe("downloaded");
  });

  it("refuses everything in a build that can't update and never loads the updater", async () => {
    const load = vi.fn();
    const controller = new UpdateController({
      current: "0.1.1",
      unsupported: "development run",
      updater: load,
      beforeInstall: async () => {},
    });
    await expect(controller.run("check")).rejects.toThrow("development run");
    await expect(controller.run("install")).rejects.toThrow("development run");
    expect(load).not.toHaveBeenCalled();
  });

  it("joins concurrent checks into one", async () => {
    const { controller, calls } = make();
    await Promise.all([controller.run("check"), controller.run("check")]);
    expect(calls).toEqual(["check"]);
  });
});

describe("server <-> main update bridge", () => {
  it("mirrors the main process's state and resolves commands by id", async () => {
    const sent: DesktopServerMessage[] = [];
    const bridge = new IpcDesktopUpdater((m) => sent.push(m), "0.1.1");
    const seen: string[] = [];
    bridge.onChange((s) => seen.push(s.phase));
    const check = bridge.run("check");
    const failing = bridge.run("download");
    expect(sent).toEqual([
      { type: "update.command", id: "1", command: "check" },
      { type: "update.command", id: "2", command: "download" },
    ]);
    const state = { ...bridge.state(), phase: "available" as const, latest: "0.2.0" };
    const replies: DesktopHostMessage[] = [
      { type: "update.state", state },
      { type: "update.done", id: "1", error: null },
      { type: "update.done", id: "2", error: "offline" },
    ];
    for (const reply of replies) expect(bridge.handle(reply)).toBe(true);
    await expect(check).resolves.toBeUndefined();
    await expect(failing).rejects.toThrow("offline");
    expect(bridge.state().latest).toBe("0.2.0");
    expect(seen).toEqual(["available"]);
    expect(bridge.handle({ type: "shutdown", stopRunner: false })).toBe(false);
  });
});

describe("activity monitor", () => {
  const respond = (routes: Record<string, unknown>) =>
    (async (url: string) => {
      const path = new URL(url).pathname;
      if (!(path in routes)) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(routes[path]), { status: 200 });
    }) as unknown as typeof fetch;

  it("reads activity and settings, and reports changes only", async () => {
    const changes: unknown[] = [];
    const monitor = new ActivityMonitor({
      baseUrl: "http://127.0.0.1:1",
      token: "t",
      fetch: respond({
        "/api/activity": { running: 1, waiting: 0, inbox: 2 },
        "/api/settings": {},
      }),
      onChange: (s) => changes.push(s),
    });
    const status = await monitor.poll();
    await monitor.poll();
    expect(status.connected).toBe(true);
    expect(status.activity).toEqual({ running: 1, waiting: 0, inbox: 2 });
    expect(status.settings?.desktop.closeToTray).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it("falls back to the snapshot on a server without /api/activity", async () => {
    const monitor = new ActivityMonitor({
      baseUrl: "http://127.0.0.1:1",
      token: "t",
      fetch: respond({
        "/api/snapshot": {
          sessions: [{ status: "running" }, { status: "waiting" }],
          inbox: [{ status: "open" }],
        },
        "/api/settings": {},
      }),
      onChange: () => {},
    });
    expect((await monitor.poll()).activity).toEqual({ running: 1, waiting: 1, inbox: 1 });
  });

  it("reports a server that stopped answering", async () => {
    const monitor = new ActivityMonitor({
      baseUrl: "http://127.0.0.1:1",
      token: "t",
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      onChange: () => {},
    });
    expect((await monitor.poll()).connected).toBe(false);
  });
});
