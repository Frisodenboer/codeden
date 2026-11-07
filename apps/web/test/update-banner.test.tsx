import type { UpdateStatus } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { bannerView } from "@/components/shell/update-banner";
import { dismissUpdate } from "@/lib/updates";

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: "0.1.0",
  latest: "0.2.0",
  updateAvailable: true,
  enabled: true,
  mode: "notify",
  checkedAt: "2026-11-07T10:00:00.000Z",
  error: null,
  command: "npm i -g codeden@latest",
  source: "packaged",
  state: "idle",
  target: null,
  progress: null,
  installError: null,
  canRestart: true,
  restartCommand: "npx codeden",
  installed: [],
  rollbackTo: null,
  canRollback: false,
  warning: null,
  ...over,
});

describe("update banner (§16)", () => {
  it("offers a newer version until it is dismissed for that version", () => {
    expect(bannerView(status(), "idle", null)).toMatchObject({
      kind: "available",
      version: "0.2.0",
    });
    dismissUpdate("0.2.0");
    expect(bannerView(status(), "idle", null)).toBeNull();
    expect(bannerView(status({ latest: "0.3.0" }), "idle", null)?.kind).toBe("available");
    expect(
      bannerView(status({ updateAvailable: false, latest: "0.1.0" }), "idle", null),
    ).toBeNull();
  });

  it("follows the install, restart and failure states", () => {
    const installing = status({ state: "installing", target: "0.3.0" });
    expect(bannerView(installing, "idle", null)).toMatchObject({
      kind: "installing",
      version: "0.3.0",
    });
    expect(bannerView(status({ state: "restarting", target: "0.3.0" }), "idle", null)?.kind).toBe(
      "handover",
    );
    expect(bannerView(status({ state: "failed", target: "0.3.0" }), "idle", null)?.kind).toBe(
      "failed",
    );
    expect(bannerView(status({ state: "installed", target: "0.3.0" }), "idle", null)?.kind).toBe(
      "installed",
    );
  });

  it("keeps showing the hand-over while the browser waits, then asks for a manual restart", () => {
    // The new server's first status is idle; the browser is still waiting for it.
    const fresh = status({ current: "0.3.0", latest: "0.3.0", updateAvailable: false });
    expect(bannerView(fresh, "waiting", "0.3.0")).toMatchObject({ kind: "handover" });
    expect(bannerView(fresh, "timeout", "0.3.0")).toMatchObject({ kind: "timeout" });
  });
});
