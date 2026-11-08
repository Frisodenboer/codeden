import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActivitySummary,
  type DesktopUpdateCommand,
  type DesktopUpdateState,
  type UpdateMode,
  type UpdateStatus,
} from "@codeden/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RunningServer, startServer } from "../src";
import { type DesktopUpdater, DesktopUpdateService } from "../src/services/updates/desktop";
import { sampleSession } from "./helpers";

const TOKEN = "d".repeat(64);

/** A scripted desktop main process: commands change the mirrored state like electron-updater. */
class FakeDesktop implements DesktopUpdater {
  current: DesktopUpdateState = {
    phase: "idle",
    current: "0.1.0",
    latest: null,
    checkedAt: null,
    percent: null,
    error: null,
    unsupported: null,
  };
  commands: DesktopUpdateCommand[] = [];
  latest = "0.2.0";
  failDownload = false;
  private listeners = new Set<(s: DesktopUpdateState) => void>();

  state() {
    return this.current;
  }
  onChange(listener: (s: DesktopUpdateState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(patch: Partial<DesktopUpdateState>) {
    this.current = { ...this.current, ...patch };
    for (const l of this.listeners) l(this.current);
  }
  async run(command: DesktopUpdateCommand) {
    this.commands.push(command);
    await Promise.resolve();
    if (command === "check") {
      this.set({
        phase: this.latest === this.current.current ? "idle" : "available",
        latest: this.latest,
        checkedAt: new Date().toISOString(),
      });
    } else if (command === "download") {
      this.set({ phase: "downloading", percent: 37.4 });
      await Promise.resolve();
      if (this.failDownload) {
        this.set({ phase: "error", error: "net::ERR_CONNECTION_RESET", percent: null });
        throw new Error("net::ERR_CONNECTION_RESET");
      }
      this.set({ phase: "downloaded", percent: 100 });
    } else {
      this.set({ phase: "installing" });
    }
  }
}

const flush = () => new Promise((r) => setTimeout(r, 10));

function service(desktop: FakeDesktop, mode: UpdateMode = "notify") {
  return new DesktopUpdateService({
    desktop,
    mode: () => mode,
    current: "0.1.0",
    notes: { releaseApi: "http://notes.test/{version}", changelog: "http://notes.test/cl" },
    fetch: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch,
  });
}

describe("desktop-managed updates", () => {
  afterEach(() => vi.useRealTimers());

  it("checks on start and offers the newer release in notify mode", async () => {
    const desktop = new FakeDesktop();
    const updates = service(desktop);
    const seen: UpdateStatus[] = [];
    updates.onChange((s) => seen.push(s));
    updates.start();
    await flush();
    updates.stop();
    expect(desktop.commands).toEqual(["check"]);
    const status = updates.snapshot();
    expect(status).toMatchObject({
      source: "desktop",
      latest: "0.2.0",
      updateAvailable: true,
      state: "idle",
      canRestart: true,
      canRollback: false,
      installed: [],
    });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("never checks when the mode is off", async () => {
    const desktop = new FakeDesktop();
    const updates = service(desktop, "off");
    updates.start();
    await updates.status({ refresh: true });
    updates.stop();
    expect(desktop.commands).toEqual([]);
    expect(updates.snapshot()).toMatchObject({ enabled: false, updateAvailable: false });
  });

  it("downloads in the background in auto mode and waits for a restart", async () => {
    const desktop = new FakeDesktop();
    const updates = service(desktop, "auto");
    updates.start();
    await flush();
    updates.stop();
    expect(desktop.commands).toEqual(["check", "download"]);
    expect(updates.snapshot()).toMatchObject({ state: "installed", target: "0.2.0" });
  });

  it("Update now downloads with progress, then installs and restarts", async () => {
    const desktop = new FakeDesktop();
    const updates = service(desktop);
    await updates.status({ refresh: true });
    const states: string[] = [];
    updates.onChange((s) => states.push(`${s.state}:${s.progress ?? ""}`));
    updates.install();
    await flush();
    expect(desktop.commands).toEqual(["check", "download", "install"]);
    expect(states).toContain("installing:Downloading 37%");
    expect(updates.snapshot()).toMatchObject({ state: "restarting", target: "0.2.0" });
    updates.stop();
  });

  it("install with restart: false leaves the download for the next launch", async () => {
    const desktop = new FakeDesktop();
    const updates = service(desktop);
    await updates.status({ refresh: true });
    updates.install({ restart: false });
    await flush();
    expect(desktop.commands).toEqual(["check", "download"]);
    expect(updates.snapshot().state).toBe("installed");
    updates.restartNow();
    await flush();
    expect(desktop.commands.at(-1)).toBe("install");
    updates.stop();
  });

  it("shows a failed download with its reason so the banner offers Retry", async () => {
    const desktop = new FakeDesktop();
    desktop.failDownload = true;
    const updates = service(desktop);
    await updates.status({ refresh: true });
    updates.install();
    await flush();
    expect(updates.snapshot()).toMatchObject({
      state: "failed",
      installError: "net::ERR_CONNECTION_RESET",
      error: null,
    });
    desktop.failDownload = false;
    updates.install();
    await flush();
    expect(updates.snapshot().state).toBe("restarting");
    updates.stop();
  });

  it("reports a build that cannot update itself instead of offering the update", async () => {
    const desktop = new FakeDesktop();
    desktop.set({ unsupported: "Updates need an installed build." });
    const updates = service(desktop);
    await updates.status({ refresh: true });
    expect(updates.snapshot()).toMatchObject({
      updateAvailable: false,
      error: "Updates need an installed build.",
      canRestart: false,
    });
    expect(() => updates.install()).toThrow(/installed build/);
    expect(() => updates.rollback()).toThrow(/roll back/);
    updates.stop();
  });

  it("checks again every 6 hours", async () => {
    vi.useFakeTimers();
    const desktop = new FakeDesktop();
    desktop.latest = "0.1.0";
    const updates = new DesktopUpdateService({
      desktop,
      mode: () => "notify",
      current: "0.1.0",
      intervalMs: 6 * 3600_000,
    });
    updates.start();
    await vi.advanceTimersByTimeAsync(6 * 3600_000 + 10);
    updates.stop();
    expect(desktop.commands).toEqual(["check", "check"]);
  });
});

describe("desktop host seam", () => {
  let home: string;
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${server?.url}/api${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("serves the desktop updater's state at /api/updates and counts activity", async () => {
    home = mkdtempSync(join(tmpdir(), "codeden-desktop-host-"));
    const desktop = new FakeDesktop();
    server = await startServer({
      port: 0,
      dataDir: home,
      token: TOKEN,
      runner: false,
      secrets: "memory",
      checkSetupOnStart: false,
      selfUpdate: {
        source: "desktop",
        restartCommand: "Quit CodeDen and open it again",
        launcherVersion: "0.1.0",
        desktop,
      },
    });
    desktop.set({ phase: "available", latest: "0.2.0", checkedAt: new Date().toISOString() });
    const updates = await call("/updates");
    expect(updates.json).toMatchObject({ source: "desktop", latest: "0.2.0", canRestart: true });
    const install = await call("/updates/install", { method: "POST", body: "{}" });
    expect(install.status).toBe(200);
    await flush();
    expect(desktop.commands).toEqual(["download", "install"]);
    const rollback = await call("/updates/rollback", { method: "POST" });
    expect(rollback.status).toBe(409);

    const empty = ActivitySummary.parse((await call("/activity")).json);
    expect(empty).toEqual({ running: 0, waiting: 0, inbox: 0 });
    server.store.append([
      { type: "session.created", sessionId: "s1", payload: { session: sampleSession } },
      {
        type: "session.created",
        sessionId: "s2",
        payload: { session: { ...sampleSession, id: "s2", status: "waiting" } },
      },
    ]);
    expect((await call("/activity")).json).toEqual({ running: 1, waiting: 1, inbox: 0 });
  });
});
