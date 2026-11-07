import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedCommand } from "../../util/exec";
import { acquireInstallLock } from "../../util/install-lock";
import { resolveNpm } from "../../util/npm";
import { runNpm } from "../../util/npm-run";

/** The Claude Agent SDK package. */
export const CLAUDE_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
/** The SDK version CodeDen is tested with (keep in step with `packages/providers/package.json`). */
export const CLAUDE_SDK_VERSION = "0.3.318";

export type ClaudeSdkModule = typeof import("@anthropic-ai/claude-agent-sdk");

/** The SDK version installed in `depsDir`, or null. */
export function installedClaudeSdkVersion(depsDir: string): string | null {
  try {
    const file = join(depsDir, "node_modules", ...CLAUDE_SDK_PACKAGE.split("/"), "package.json");
    const version = JSON.parse(readFileSync(file, "utf8")).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** True when `depsDir` holds the tested SDK version. */
export function isClaudeSdkInstalled(depsDir: string): boolean {
  return installedClaudeSdkVersion(depsDir) === CLAUDE_SDK_VERSION;
}

/** Import the SDK installed in `depsDir` (absolute file URL, so it also works on Windows). */
export async function importClaudeSdkFrom(depsDir: string): Promise<ClaudeSdkModule> {
  const entry = createRequire(join(depsDir, "package.json")).resolve(CLAUDE_SDK_PACKAGE);
  const sdk = (await import(pathToFileURL(entry).href)) as ClaudeSdkModule;
  if (typeof sdk.query !== "function") throw new Error(`${entry} does not export query()`);
  return sdk;
}

export interface InstallClaudeSdkOptions {
  depsDir: string;
  /** Progress lines for the UI ("Downloading ...", npm output). */
  onProgress?: (line: string) => void;
  /** Override npm (tests). */
  npm?: ResolvedCommand;
  /** npm timeout (default 5 minutes). */
  timeoutMs?: number;
}

const inflight = new Map<string, Promise<void>>();

/**
 * Install the tested SDK version into `depsDir` with npm, skipping its optional platform
 * binaries and peers (the JS entry needs neither when CodeDen passes the user's `claude`).
 * Concurrent calls share one install per process; a lock file covers other processes.
 * Resolves immediately when it is already installed.
 */
export function installClaudeSdk(opts: InstallClaudeSdkOptions): Promise<void> {
  if (isClaudeSdkInstalled(opts.depsDir)) return Promise.resolve();
  let running = inflight.get(opts.depsDir);
  if (!running) {
    running = runInstall(opts).finally(() => inflight.delete(opts.depsDir));
    inflight.set(opts.depsDir, running);
  }
  return running;
}

async function runInstall(opts: InstallClaudeSdkOptions): Promise<void> {
  const progress = opts.onProgress ?? (() => {});
  mkdirSync(opts.depsDir, { recursive: true });
  const release = await acquireInstallLock(join(opts.depsDir, ".install.lock"), {
    onWait: () => progress("Waiting for another install to finish"),
  });
  try {
    if (isClaudeSdkInstalled(opts.depsDir)) return;
    const manifest = join(opts.depsDir, "package.json");
    if (!existsSync(manifest)) {
      writeFileSync(
        manifest,
        `${JSON.stringify({ name: "codeden-deps", private: true }, null, 2)}\n`,
      );
    }
    const npm = opts.npm ?? resolveNpm();
    if (!npm) throw new Error("npm was not found; install Node.js with npm and try again");
    const spec = `${CLAUDE_SDK_PACKAGE}@${CLAUDE_SDK_VERSION}`;
    progress(`Downloading ${spec} from npm`);
    await runNpm(
      npm,
      [
        "install",
        spec,
        "--omit=optional",
        "--omit=peer",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "--prefix",
        opts.depsDir,
      ],
      { cwd: opts.depsDir, timeoutMs: opts.timeoutMs ?? 300_000, onLine: progress },
    );
    const version = installedClaudeSdkVersion(opts.depsDir);
    if (version !== CLAUDE_SDK_VERSION) {
      throw new Error(`npm finished but ${spec} is not in ${opts.depsDir}`);
    }
    progress("Checking the install");
    await importClaudeSdkFrom(opts.depsDir);
    progress(`Installed ${spec}`);
  } finally {
    release();
  }
}
