import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_SDK_PACKAGE,
  CLAUDE_SDK_VERSION,
  type InstallClaudeSdkOptions,
} from "@codeden/providers";
import { describe, expect, it } from "vitest";
import { ClaudeSdkService } from "../src/services/setup/claude-sdk";

/** Writes a tiny loadable SDK into the deps folder, like a successful npm install. */
function fakeInstall(opts: InstallClaudeSdkOptions): Promise<void> {
  return new Promise((resolve) => {
    opts.onProgress?.("Downloading from npm");
    setTimeout(() => {
      const dir = join(opts.depsDir, "node_modules", ...CLAUDE_SDK_PACKAGE.split("/"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(opts.depsDir, "package.json"), "{}");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: CLAUDE_SDK_PACKAGE, version: CLAUDE_SDK_VERSION, main: "sdk.mjs" }),
      );
      writeFileSync(join(dir, "sdk.mjs"), "export function query() {}\n");
      resolve();
    }, 50);
  });
}

const depsDir = () => join(mkdtempSync(join(tmpdir(), "codeden-sdk-svc-")), "deps");

describe("ClaudeSdkService", () => {
  it("is always ready from the workspace", () => {
    const service = new ClaudeSdkService({ depsDir: depsDir(), source: () => "workspace" });
    expect(service.status()).toMatchObject({ state: "ready", source: "workspace" });
  });

  it("installs on demand with progress, once, then reports ready", async () => {
    let installs = 0;
    const service = new ClaudeSdkService({
      depsDir: depsDir(),
      source: () => "deps",
      install: (opts) => {
        installs++;
        return fakeInstall(opts);
      },
    });
    expect(service.status().state).toBe("missing");
    const started = service.install();
    expect(started.state).toBe("installing");
    expect(service.install().state).toBe("installing");
    expect(service.status().progress).toBe("Downloading from npm");
    const done = await service.settled();
    expect(done).toMatchObject({ state: "ready", version: CLAUDE_SDK_VERSION, progress: null });
    expect(installs).toBe(1);
  });

  it("reports a failed install with the reason and retries", async () => {
    let fail = true;
    const service = new ClaudeSdkService({
      depsDir: depsDir(),
      source: () => "deps",
      install: async (opts) => {
        if (fail) throw new Error("npm install exited with code 1: E404");
        await fakeInstall(opts);
      },
    });
    service.install();
    expect(await service.settled()).toMatchObject({
      state: "failed",
      error: "npm install exited with code 1: E404",
    });
    fail = false;
    service.install();
    expect((await service.settled()).state).toBe("ready");
  });
});
