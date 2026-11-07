import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareVersions } from "@codeden/contracts";
import { writePointer } from "@codeden/server";
import { describe, expect, it } from "vitest";
import {
  compareCore,
  decideLaunch,
  homeFromArgs,
  installKind,
  isSourceCheckout,
  managedEntry,
  parseLaunchedBy,
  readPinnedVersion,
  restartCommandFor,
} from "../src/launcher";
import { relaunchArgs } from "../src/restart";

/** A published-looking copy (no `src/` next to `dist/`) of `version` at `<dir>/dist/cli.js`. */
function packagedCopy(dir: string, version: string): string {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "codeden", version }));
  writeFileSync(join(dir, "dist", "cli.js"), "");
  return join(dir, "dist", "cli.js");
}

function setup(pinned: string | null, installed: string[] = []) {
  const base = mkdtempSync(join(tmpdir(), "codeden-launcher-"));
  const home = join(base, "home");
  const selfEntry = packagedCopy(join(base, "global", "node_modules", "codeden"), "0.2.0");
  for (const v of installed) packagedCopy(join(home, "app", v, "node_modules", "codeden"), v);
  if (pinned) writePointer(home, pinned, "0.2.0");
  return { home, selfEntry, base };
}

describe("launcher (§16)", () => {
  it("switches to a newer installed version", () => {
    const { home, selfEntry } = setup("0.3.0", ["0.3.0"]);
    expect(decideLaunch({ selfEntry, selfVersion: "0.2.0", home, env: {} })).toEqual({
      kind: "switch",
      version: "0.3.0",
      entry: managedEntry(home, "0.3.0"),
    });
  });

  it("runs itself when the pin is older, equal, missing or switching is off", () => {
    const older = setup("0.1.5", ["0.1.5"]);
    expect(decideLaunch({ ...older, selfVersion: "0.2.0", env: {} }).kind).toBe("self");
    const equal = setup("0.2.0", ["0.2.0"]);
    expect(decideLaunch({ ...equal, selfVersion: "0.2.0", env: {} }).kind).toBe("self");
    const none = setup(null);
    expect(decideLaunch({ ...none, selfVersion: "0.2.0", env: {} })).toEqual({
      kind: "self",
      warning: null,
    });
    const newer = setup("0.3.0", ["0.3.0"]);
    const off = { ...newer, selfVersion: "0.2.0" };
    expect(decideLaunch({ ...off, env: { CODEDEN_NO_SWITCH: "1" } }).kind).toBe("self");
    expect(decideLaunch({ ...off, env: {}, alreadyLaunched: true }).kind).toBe("self");
  });

  it("falls back to itself with a warning when the pinned version is broken", () => {
    const missing = setup("0.3.0");
    const decision = decideLaunch({ ...missing, selfVersion: "0.2.0", env: {} });
    expect(decision.kind).toBe("self");
    expect(decision.kind === "self" && decision.warning).toMatch(
      /CodeDen 0\.3\.0 .* can't start \(its package\.json is missing\); running 0\.2\.0/,
    );
    const mislabelled = setup("0.3.0", ["0.3.0"]);
    writeFileSync(
      join(mislabelled.home, "app", "0.3.0", "node_modules", "codeden", "package.json"),
      JSON.stringify({ version: "0.2.9" }),
    );
    const d2 = decideLaunch({ ...mislabelled, selfVersion: "0.2.0", env: {} });
    expect(d2.kind === "self" && d2.warning).toContain("its package.json says 0.2.9");
  });

  it("never switches from a source checkout", () => {
    const repoEntry = resolve(import.meta.dirname, "../src/cli.ts");
    expect(isSourceCheckout(repoEntry)).toBe(true);
    const { home } = setup("9.9.9", ["9.9.9"]);
    expect(decideLaunch({ selfEntry: repoEntry, selfVersion: "0.1.0", home, env: {} }).kind).toBe(
      "self",
    );
    expect(installKind(repoEntry, home)).toBe("source");
  });

  it("tells npx, npm and managed copies apart", () => {
    const { home, selfEntry, base } = setup("0.3.0", ["0.3.0"]);
    expect(installKind(selfEntry, home)).toBe("npm");
    expect(installKind(managedEntry(home, "0.3.0"), home)).toBe("managed");
    const npx = packagedCopy(join(base, "_npx", "abc123", "node_modules", "codeden"), "0.2.0");
    expect(installKind(npx, home)).toBe("npx");
    expect(restartCommandFor("npx", npx)).toBe("npx codeden");
    expect(restartCommandFor("npm", selfEntry)).toBe("codeden");
  });

  it("reads what the server writes to current.json, and ignores anything else", () => {
    const { home } = setup("0.3.0-beta.1");
    expect(readPinnedVersion(home)).toBe("0.3.0-beta.1");
    writeFileSync(join(home, "app", "current.json"), JSON.stringify({ version: "../../evil" }));
    expect(readPinnedVersion(home)).toBeNull();
    writeFileSync(join(home, "app", "current.json"), "{ not json");
    expect(readPinnedVersion(home)).toBeNull();
  });

  it("keeps the originally launched copy across restarts", () => {
    const raw = JSON.stringify({
      binEntry: "/g/codeden/dist/cli.js",
      binVersion: "0.1.0",
      kind: "npx",
    });
    expect(parseLaunchedBy(raw, "/h")).toMatchObject({
      binVersion: "0.1.0",
      source: "packaged",
      restartCommand: "npx codeden",
    });
    expect(
      parseLaunchedBy(JSON.stringify({ binEntry: "x", binVersion: "1", kind: "source" }), "/h"),
    ).toBeNull();
    expect(parseLaunchedBy("{", "/h")).toBeNull();
    expect(parseLaunchedBy(undefined, "/h")).toBeNull();
  });

  it("resolves the home like the server", () => {
    expect(homeFromArgs(["--home", "x"], {})).toBe(resolve("x"));
    expect(homeFromArgs(["--port", "1", "--home=y"], {})).toBe(resolve("y"));
    expect(homeFromArgs([], { CODEDEN_HOME: "z" })).toBe(resolve("z"));
    expect(homeFromArgs([], {})).toBe(join(homedir(), ".codeden"));
  });

  it("compares versions like the contracts", () => {
    const samples = ["0.1.0", "0.1.1-test", "0.1.1", "0.2.0-beta.2", "0.2.0-beta.10", "1.0.0"];
    for (const a of samples) {
      for (const b of samples) {
        expect(Math.sign(compareCore(a, b))).toBe(Math.sign(compareVersions(a, b)));
      }
    }
  });

  it("restarts with the same arguments on the same port, without opening a tab", () => {
    expect(relaunchArgs(["--home", "h", "--port", "0", "--no-open"], 4317)).toEqual([
      "--home",
      "h",
      "--port",
      "4317",
      "--no-open",
    ]);
    expect(relaunchArgs(["--port=5000"], 5000)).toEqual(["--port", "5000", "--no-open"]);
  });
});
