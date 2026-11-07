import { describe, expect, it } from "vitest";
import { isNewerVersion, UpdateStatus } from "../src";

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
  });

  it("round-trips the status", () => {
    const status = {
      current: "0.1.0",
      latest: "0.2.0",
      updateAvailable: true,
      enabled: true,
      checkedAt: "2026-11-07T10:00:00.000Z",
      error: null,
      command: "npm i -g codeden@latest",
    };
    expect(UpdateStatus.parse(JSON.parse(JSON.stringify(status)))).toEqual(status);
  });
});
