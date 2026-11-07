import { describe, expect, it } from "vitest";
import {
  AppPointer,
  compareVersions,
  defaultSettings,
  isNewerVersion,
  ReleaseNotes,
  ServerToClientMessage,
  Settings,
  UpdateInstallRequest,
  UpdateStatus,
} from "../src";

const sampleUpdateStatus: UpdateStatus = {
  current: "0.1.0",
  latest: "0.2.0",
  updateAvailable: true,
  enabled: true,
  mode: "notify",
  checkedAt: "2026-11-07T10:00:00.000Z",
  error: null,
  command: "npm i -g codeden@latest",
  source: "packaged",
  state: "installing",
  target: "0.2.0",
  progress: "added 3 packages in 2s",
  installError: null,
  canRestart: true,
  restartCommand: "npx codeden",
  installed: [{ version: "0.2.0", current: false, valid: true }],
  rollbackTo: null,
  canRollback: false,
  warning: null,
};

describe("update check", () => {
  it("compares versions", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.1.0-beta.1")).toBe(true);
    expect(isNewerVersion("0.1.0-beta.1", "0.1.0")).toBe(false);
    expect(isNewerVersion("v0.3.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.1.1-test", "0.1.0")).toBe(true);
  });

  it("orders prerelease identifiers like semver", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
    expect(["0.2.0", "0.10.0", "0.2.0-rc.1", "0.9.1"].sort(compareVersions)).toEqual([
      "0.2.0-rc.1",
      "0.2.0",
      "0.9.1",
      "0.10.0",
    ]);
  });

  it("round-trips the status and its WebSocket message", () => {
    const json = JSON.parse(JSON.stringify(sampleUpdateStatus));
    expect(UpdateStatus.parse(json)).toEqual(sampleUpdateStatus);
    const msg = { type: "update", update: sampleUpdateStatus };
    expect(ServerToClientMessage.parse(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });

  it("round-trips requests, notes and current.json", () => {
    expect(UpdateInstallRequest.parse({})).toEqual({});
    expect(UpdateInstallRequest.parse({ version: "0.2.0", restart: false })).toEqual({
      version: "0.2.0",
      restart: false,
    });
    const notes = { version: "0.2.0", body: "## Added", url: "https://example.test/v0.2.0" };
    expect(ReleaseNotes.parse(notes)).toEqual(notes);
    const pointer = { version: "0.2.0", previous: "0.1.0", updatedAt: "2026-11-07T10:00:00Z" };
    expect(AppPointer.parse(JSON.parse(JSON.stringify(pointer)))).toEqual(pointer);
    expect(AppPointer.safeParse({ version: "" }).success).toBe(false);
  });

  it("defaults to notify and reads the old check switch", () => {
    expect(defaultSettings().updates).toEqual({ mode: "notify" });
    expect(Settings.parse({ updates: { check: false } }).updates).toEqual({ mode: "off" });
    expect(Settings.parse({ updates: { check: true } }).updates).toEqual({ mode: "notify" });
    expect(Settings.parse({ updates: { mode: "auto" } }).updates).toEqual({ mode: "auto" });
    expect(Settings.safeParse({ updates: { mode: "sometimes" } }).success).toBe(false);
  });
});
