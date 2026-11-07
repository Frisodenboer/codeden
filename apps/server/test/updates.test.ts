import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedCommand } from "@codeden/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRollback,
  listInstalled,
  packageRoot,
  pruneInstalled,
  readPointer,
  writePointer,
} from "../src/services/updates/app-dir";
import { installAppVersion } from "../src/services/updates/installer";
import { writeUpdateResult } from "../src/services/updates/last-result";
import { changelogSection, fetchReleaseNotes } from "../src/services/updates/registry";
import { type SelfUpdateHost, UpdateService } from "../src/services/updates/service";

const REGISTRY = "http://registry.test";
const fakeNpm: ResolvedCommand = {
  kind: "node-script",
  path: process.execPath,
  script: join(import.meta.dirname, "fixtures", "fake-npm-codeden", "npm-cli.mjs"),
};

const tempHome = () => mkdtempSync(join(tmpdir(), "codeden-updates-"));

/** A registry answering `dist-tags` with `latest` (or failing when null). */
const registry = (latest: string | null) => {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    if (latest === null) throw new Error("getaddrinfo ENOTFOUND registry.test");
    return new Response(JSON.stringify({ latest }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

/** Lay out `<home>/app/<version>` like a finished install. */
function fakeInstall(home: string, version: string): void {
  const root = packageRoot(home, version);
  mkdirSync(join(root, "dist", "web"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "codeden", version }));
  for (const f of ["dist/cli.js", "dist/runner.js", "dist/web/index.html"]) {
    writeFileSync(join(root, f), "");
  }
}

const packagedHost = (restart?: SelfUpdateHost["restart"]): SelfUpdateHost => ({
  source: "packaged",
  restart,
  restartCommand: "npx codeden",
  launcherVersion: "0.1.0",
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.FAKE_NPM_FAIL;
  delete process.env.FAKE_NPM_REPORT;
});

describe("update check (§16)", () => {
  it("asks for the latest dist-tag every six hours, refreshing on request", async () => {
    let now = Date.parse("2026-11-07T10:00:00Z");
    const r = registry("0.2.0");
    const s = new UpdateService({
      home: tempHome(),
      mode: () => "notify",
      registry: REGISTRY,
      fetch: r.fetch,
      current: "0.1.0",
      now: () => now,
    });
    expect(await s.status()).toMatchObject({
      current: "0.1.0",
      latest: "0.2.0",
      updateAvailable: true,
      enabled: true,
      mode: "notify",
      source: "source",
      state: "idle",
      canRestart: false,
      error: null,
    });
    await s.status();
    expect(r.calls).toEqual([`${REGISTRY}/-/package/codeden/dist-tags`]);
    await s.status({ refresh: true });
    expect(r.calls).toHaveLength(2);
    now += 7 * 3600_000;
    await s.status();
    expect(r.calls).toHaveLength(3);
  });

  it("is quiet when up to date, offline or off", async () => {
    const base = { home: tempHome(), registry: REGISTRY, current: "0.1.0" };
    const same = new UpdateService({
      ...base,
      mode: () => "notify",
      fetch: registry("0.1.0").fetch,
    });
    expect((await same.status()).updateAvailable).toBe(false);
    const offline = new UpdateService({ ...base, mode: () => "auto", fetch: registry(null).fetch });
    expect(await offline.status()).toMatchObject({ latest: null, updateAvailable: false });
    expect((await offline.status()).error).toContain("ENOTFOUND");
    const off = registry("9.9.9");
    const disabled = new UpdateService({ ...base, mode: () => "off", fetch: off.fetch });
    expect(await disabled.status()).toMatchObject({ enabled: false, updateAvailable: false });
    const env = new UpdateService({
      ...base,
      mode: () => "notify",
      checksDisabled: true,
      fetch: off.fetch,
    });
    expect((await env.status()).enabled).toBe(false);
    expect(off.calls).toEqual([]);
  });
});

describe("one-click self-update (§16)", () => {
  it("installs, points current.json at the new version and hands over", async () => {
    const home = tempHome();
    const restarts: Array<string | null> = [];
    const states: string[] = [];
    const s = new UpdateService({
      home,
      mode: () => "notify",
      registry: REGISTRY,
      fetch: registry("0.2.0").fetch,
      current: "0.1.0",
      host: packagedHost(({ version }) => restarts.push(version)),
      install: async ({ version, onProgress }) => {
        onProgress?.("added 4 packages");
        fakeInstall(home, version);
      },
    });
    s.onChange((status) => states.push(status.state));
    await s.status();
    expect(s.install()).toMatchObject({ state: "installing", canRestart: true });
    await vi.waitFor(() => expect(restarts).toEqual(["0.2.0"]));
    expect(readPointer(home)).toMatchObject({ version: "0.2.0", previous: "0.1.0" });
    expect(s.snapshot()).toMatchObject({ state: "restarting", target: "0.2.0", canRollback: true });
    expect(states).toContain("installing");
    expect(states.at(-1)).toBe("restarting");
    expect(s.snapshot().installed).toEqual([{ version: "0.2.0", current: true, valid: true }]);
  });

  it("reports install failures and refuses to update a source checkout", async () => {
    const home = tempHome();
    const s = new UpdateService({
      home,
      mode: () => "notify",
      registry: REGISTRY,
      current: "0.1.0",
      host: packagedHost(() => {}),
      install: async () => {
        throw new Error("npm install exited with code 1: code E404");
      },
    });
    s.install({ version: "0.2.0" });
    await vi.waitFor(() => expect(s.snapshot().state).toBe("failed"));
    expect(s.snapshot().installError).toContain("E404");
    expect(readPointer(home)).toBeNull();
    const dev = new UpdateService({ home, mode: () => "notify", registry: REGISTRY });
    expect(() => dev.install({ version: "0.2.0" })).toThrow(/running CodeDen from source/);
  });

  it("auto mode installs in the background for the next launch", async () => {
    const home = tempHome();
    const restart = vi.fn();
    const s = new UpdateService({
      home,
      mode: () => "auto",
      registry: REGISTRY,
      fetch: registry("0.3.0").fetch,
      current: "0.1.0",
      host: packagedHost(restart),
      install: async ({ version }) => fakeInstall(home, version),
    });
    s.start();
    await vi.waitFor(() => expect(s.snapshot().state).toBe("installed"));
    s.stop();
    expect(s.snapshot().target).toBe("0.3.0");
    expect(restart).not.toHaveBeenCalled();
    s.restartNow();
    await vi.waitFor(() => expect(restart).toHaveBeenCalledWith({ version: "0.3.0" }));
  });

  it("without a restart hook it leaves the update for the next launch", async () => {
    const home = tempHome();
    const s = new UpdateService({
      home,
      mode: () => "notify",
      registry: REGISTRY,
      current: "0.1.0",
      host: { ...packagedHost(), restartCommand: "codeden" },
      install: async ({ version }) => fakeInstall(home, version),
    });
    s.install({ version: "0.2.0" });
    await vi.waitFor(() => expect(s.snapshot().state).toBe("installed"));
    expect(s.snapshot()).toMatchObject({ canRestart: false, restartCommand: "codeden" });
  });

  it("shows a failed hand-over recorded by the CLI once", () => {
    const home = tempHome();
    writeUpdateResult(home, { from: "0.1.0", to: "0.2.0", ok: false, error: "exited with 1" });
    const s = new UpdateService({ home, mode: () => "notify", registry: REGISTRY });
    expect(s.snapshot()).toMatchObject({ state: "failed", installError: "exited with 1" });
    const again = new UpdateService({ home, mode: () => "notify", registry: REGISTRY });
    expect(again.snapshot().state).toBe("idle");
  });

  it("rolls back to the previous version, or to the launched copy", async () => {
    const home = tempHome();
    fakeInstall(home, "0.2.0");
    fakeInstall(home, "0.3.0");
    writePointer(home, "0.3.0", "0.2.0");
    const restarts: Array<string | null> = [];
    const s = new UpdateService({
      home,
      mode: () => "notify",
      registry: REGISTRY,
      current: "0.3.0",
      host: packagedHost(({ version }) => restarts.push(version)),
    });
    expect(s.snapshot()).toMatchObject({ rollbackTo: "0.2.0", canRollback: true });
    s.rollback();
    await vi.waitFor(() => expect(restarts).toEqual(["0.2.0"]));
    expect(readPointer(home)).toMatchObject({ version: "0.2.0", previous: "0.3.0" });

    writePointer(home, "0.2.0", "0.1.0");
    expect(applyRollback(home, "0.1.0")).toEqual({ next: "0.1.0", pinned: false });
    expect(readPointer(home)).toBeNull();
    expect(applyRollback(home, "0.1.0")).toBeNull();
  });
});

describe("side-by-side installs", () => {
  it("installs with npm into a staging folder, checks the CLI and moves it into place", async () => {
    const home = tempHome();
    const progress: string[] = [];
    await installAppVersion({
      home,
      version: "0.2.0",
      registry: REGISTRY,
      npm: fakeNpm,
      onProgress: (l) => progress.push(l),
    });
    expect(existsSync(join(packageRoot(home, "0.2.0"), "dist", "cli.js"))).toBe(true);
    const calls = readFileSync(join(home, "app", "calls.log"), "utf8")
      .trim()
      .split("\n");
    expect(calls).toHaveLength(1);
    const args = JSON.parse(calls[0] ?? "[]") as string[];
    expect(args).toEqual(
      expect.arrayContaining(["install", "codeden@0.2.0", "--omit=dev", "--no-audit", "--no-fund"]),
    );
    expect(args.slice(-2)).toEqual(["--registry", REGISTRY]);
    expect(progress).toContain("Installed codeden@0.2.0");
    // Already installed: npm is not run again.
    await installAppVersion({ home, version: "0.2.0", npm: fakeNpm });
    expect(
      readFileSync(join(home, "app", "calls.log"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(1);
    expect(listInstalled(home).map((v) => v.version)).toEqual(["0.2.0"]);
  });

  it("rejects an install whose CLI reports another version and leaves nothing behind", async () => {
    const home = tempHome();
    process.env.FAKE_NPM_REPORT = "0.1.0";
    await expect(installAppVersion({ home, version: "0.2.0", npm: fakeNpm })).rejects.toThrow(
      /reports "0.1.0" instead of 0.2.0/,
    );
    process.env.FAKE_NPM_FAIL = "1";
    await expect(installAppVersion({ home, version: "0.2.1", npm: fakeNpm })).rejects.toThrow(
      /E404/,
    );
    expect(listInstalled(home)).toEqual([]);
    await expect(installAppVersion({ home, version: "../x", npm: fakeNpm })).rejects.toThrow(
      /not a version/,
    );
  });

  it("prunes to the pinned and previous versions plus the running one", () => {
    const home = tempHome();
    for (const v of ["0.1.0", "0.2.0", "0.3.0", "0.4.0"]) fakeInstall(home, v);
    mkdirSync(join(home, "app", ".staging-0.5.0-999999999"));
    writePointer(home, "0.4.0", "0.3.0");
    expect(pruneInstalled(home, ["0.2.0"])).toEqual(["0.1.0"]);
    expect(listInstalled(home).map((v) => v.version)).toEqual(["0.4.0", "0.3.0", "0.2.0"]);
    expect(existsSync(join(home, "app", ".staging-0.5.0-999999999"))).toBe(false);
    expect(listInstalled(home)[0]).toEqual({ version: "0.4.0", current: true, valid: true });
  });
});

describe("release notes", () => {
  const changelog =
    "# Changelog\n\n## [0.2.0] - 2026-11-20\n\n### Added\n\n- Self-update\n\n## [0.1.0]\n\n- First\n";

  it("extracts a changelog section", () => {
    expect(changelogSection(changelog, "0.2.0")).toBe("### Added\n\n- Self-update");
    expect(changelogSection(changelog, "0.1.0")).toBe("- First");
    expect(changelogSection(changelog, "0.3.0")).toBeNull();
  });

  it("prefers the release body, then the changelog, then just a link", async () => {
    const fetchWith = (release: unknown, text = changelog) =>
      (async (url: string) =>
        String(url).includes("CHANGELOG")
          ? new Response(text)
          : release === null
            ? new Response("not found", { status: 404 })
            : new Response(JSON.stringify(release))) as unknown as typeof fetch;
    const sources = {
      releaseApi: "http://gh.test/v{version}",
      changelog: "http://gh.test/CHANGELOG.md",
    };
    expect(
      await fetchReleaseNotes("0.2.0", sources, fetchWith({ body: "Notes", html_url: "http://r" })),
    ).toEqual({ version: "0.2.0", body: "Notes", url: "http://r" });
    expect((await fetchReleaseNotes("0.2.0", sources, fetchWith(null))).body).toContain(
      "Self-update",
    );
    const none = await fetchReleaseNotes("0.9.0", sources, fetchWith(null));
    expect(none.body).toBeNull();
    expect(none.url).toContain("/releases/tag/v0.9.0");
  });
});
