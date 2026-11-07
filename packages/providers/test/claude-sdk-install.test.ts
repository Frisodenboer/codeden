import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SDK_PACKAGE,
  CLAUDE_SDK_VERSION,
  claudeSdkSource,
  importClaudeSdkFrom,
  installClaudeSdk,
  installedClaudeSdkVersion,
  isClaudeSdkInstalled,
} from "../src/claude/sdk";
import type { ResolvedCommand } from "../src/util/exec";
import { acquireInstallLock } from "../src/util/install-lock";
import { resolveNpm } from "../src/util/npm";
import { npmFailure } from "../src/util/npm-run";

const fakeNpm: ResolvedCommand = {
  kind: "node-script",
  path: process.execPath,
  script: join(import.meta.dirname, "fixtures", "fake-npm", "npm-cli.mjs"),
};

const depsDir = () => mkdtempSync(join(tmpdir(), "codeden-deps-"));
const calls = (dir: string): string[][] =>
  existsSync(join(dir, "calls.log"))
    ? readFileSync(join(dir, "calls.log"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
    : [];

afterEach(() => {
  delete process.env.FAKE_NPM_FAIL;
  delete process.env.FAKE_NPM_DELAY_MS;
  delete process.env.FAKE_NPM_VERSION;
  delete process.env.CODEDEN_CLAUDE_SDK;
});

describe("Claude SDK on-demand install", () => {
  it("installs the tested version without optional or peer deps, then imports it", async () => {
    const dir = depsDir();
    const lines: string[] = [];
    expect(isClaudeSdkInstalled(dir)).toBe(false);
    await installClaudeSdk({ depsDir: dir, npm: fakeNpm, onProgress: (l) => lines.push(l) });

    const [args] = calls(dir);
    expect(args).toEqual(
      expect.arrayContaining([
        "install",
        `${CLAUDE_SDK_PACKAGE}@${CLAUDE_SDK_VERSION}`,
        "--omit=optional",
        "--omit=peer",
        "--prefix",
        dir,
      ]),
    );
    expect(installedClaudeSdkVersion(dir)).toBe(CLAUDE_SDK_VERSION);
    expect(lines[0]).toContain("Downloading");
    expect(lines.at(-1)).toContain("Installed");
    const sdk = await importClaudeSdkFrom(dir);
    expect(typeof sdk.query).toBe("function");
    expect(existsSync(join(dir, ".install.lock"))).toBe(false);

    // Already installed: npm is not run again.
    await installClaudeSdk({ depsDir: dir, npm: fakeNpm });
    expect(calls(dir)).toHaveLength(1);
  });

  it("runs npm once for concurrent callers", async () => {
    const dir = depsDir();
    process.env.FAKE_NPM_DELAY_MS = "300";
    await Promise.all([1, 2, 3].map(() => installClaudeSdk({ depsDir: dir, npm: fakeNpm })));
    expect(calls(dir)).toHaveLength(1);
  });

  it("waits for another process holding the lock instead of installing twice", async () => {
    const dir = depsDir();
    mkdirSync(dir, { recursive: true });
    const release = await acquireInstallLock(join(dir, ".install.lock"));
    const lines: string[] = [];
    const done = installClaudeSdk({ depsDir: dir, npm: fakeNpm, onProgress: (l) => lines.push(l) });
    await new Promise((r) => setTimeout(r, 200));
    expect(lines).toContain("Waiting for another install to finish");
    expect(calls(dir)).toHaveLength(0);
    release();
    await done;
    expect(calls(dir)).toHaveLength(1);
  });

  it("takes over a lock left by a process that is gone", async () => {
    const dir = depsDir();
    const child = spawn(process.execPath, ["-e", ""]);
    await new Promise((r) => child.on("exit", r));
    writeFileSync(join(dir, ".install.lock"), JSON.stringify({ pid: child.pid, at: "x" }));
    await installClaudeSdk({ depsDir: dir, npm: fakeNpm });
    expect(isClaudeSdkInstalled(dir)).toBe(true);
  });

  it("reports npm's output on failure, releases the lock and can retry", async () => {
    const dir = depsDir();
    process.env.FAKE_NPM_FAIL = "1";
    await expect(installClaudeSdk({ depsDir: dir, npm: fakeNpm })).rejects.toThrow(
      "npm install exited with code 1: code E404: 404 Not Found",
    );
    expect(existsSync(join(dir, ".install.lock"))).toBe(false);
    delete process.env.FAKE_NPM_FAIL;
    await installClaudeSdk({ depsDir: dir, npm: fakeNpm });
    expect(isClaudeSdkInstalled(dir)).toBe(true);
  });

  it("installs the same SDK version the workspace is tested with", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
    expect(pkg.dependencies[CLAUDE_SDK_PACKAGE]).toBe(CLAUDE_SDK_VERSION);
  });

  it("summarises npm's error output without stack frames", () => {
    const output = [
      "npm error code ECONNREFUSED",
      "npm error syscall connect",
      "npm error errno ECONNREFUSED",
      "npm error FetchError: request to http://127.0.0.1:9/x failed, reason: connect ECONNREFUSED",
      "npm error     at ClientRequest.<anonymous> (index.js:130:14)",
      "npm error   type: 'system',",
      "npm error A complete log of this run can be found in: x.log",
    ].join("\n");
    expect(npmFailure(output)).toBe(
      "code ECONNREFUSED: FetchError: request to http://127.0.0.1:9/x failed, reason: connect ECONNREFUSED",
    );
  });

  it("rejects an install that did not produce the tested version", async () => {
    const dir = depsDir();
    process.env.FAKE_NPM_VERSION = "0.0.1";
    await expect(installClaudeSdk({ depsDir: dir, npm: fakeNpm })).rejects.toThrow(/is not in/);
  });

  it("uses the workspace SDK unless the published build or CODEDEN_CLAUDE_SDK says otherwise", () => {
    expect(claudeSdkSource()).toBe("workspace");
    process.env.CODEDEN_CLAUDE_SDK = "deps";
    expect(claudeSdkSource()).toBe("deps");
  });

  it("runs npm through node, preferring the npm that launched us", () => {
    const cli = join(depsDir(), "npm-cli.js");
    writeFileSync(cli, "");
    expect(resolveNpm({ npm_execpath: cli })).toEqual({
      kind: "node-script",
      path: process.execPath,
      script: cli,
    });
    // Without it: the npm shipped next to this Node binary (or npm on PATH).
    expect(resolveNpm({})).toBeDefined();
  });
});
