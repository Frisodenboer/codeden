import { type ClaudeSdkModule, importClaudeSdkFrom, installClaudeSdk } from "./install";

/**
 * Set to `true` by the published bundle (tsdown `define`): the SDK is not shipped with
 * CodeDen and is installed on demand into `<home>/deps`. Undefined in the workspace, where
 * the SDK resolves from `node_modules` like any other dependency.
 */
declare const __CODEDEN_CLAUDE_SDK_ON_DEMAND__: boolean | undefined;

/** Where the SDK comes from in this process. `CODEDEN_CLAUDE_SDK=deps|workspace` overrides. */
export function claudeSdkSource(): "deps" | "workspace" {
  const forced = process.env.CODEDEN_CLAUDE_SDK;
  if (forced === "deps" || forced === "workspace") return forced;
  return typeof __CODEDEN_CLAUDE_SDK_ON_DEMAND__ !== "undefined" && __CODEDEN_CLAUDE_SDK_ON_DEMAND__
    ? "deps"
    : "workspace";
}

let depsDir: string | undefined;
let progressListener: ((line: string) => void) | undefined;
let loaded: Promise<ClaudeSdkModule> | undefined;

/** Tell the loader where on-demand dependencies live (`<home>/deps`). */
export function configureClaudeSdk(opts: {
  depsDir: string;
  onProgress?: (line: string) => void;
}): void {
  depsDir = opts.depsDir;
  progressListener = opts.onProgress;
  loaded = undefined;
}

/**
 * The Claude Agent SDK module, installed first when needed. Failures are not cached, so the
 * next session retries the install.
 */
export function loadClaudeSdk(): Promise<ClaudeSdkModule> {
  loaded ??= load().catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

async function load(): Promise<ClaudeSdkModule> {
  if (claudeSdkSource() === "workspace") return import("@anthropic-ai/claude-agent-sdk");
  if (!depsDir) throw new Error("Claude Code support is not configured (no deps folder)");
  try {
    await installClaudeSdk({ depsDir, onProgress: progressListener });
    return await importClaudeSdkFrom(depsDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Claude Code support could not be installed into ${depsDir}: ${reason}. ` +
        "Start the session again to retry, use Settings > First-run setup, or run `codeden doctor --install`.",
    );
  }
}
