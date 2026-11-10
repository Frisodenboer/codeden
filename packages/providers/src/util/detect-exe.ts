import path from "node:path";
import type { BrokenExecutable } from "@codeden/contracts";
import type { ResolvedCommand } from "./exec";
import { type ExecutableLookup, findExecutable, type LocateOptions, runsVersion } from "./locate";

export interface DetectExeOptions {
  /** Use this copy instead of looking (tests, explicit configuration). */
  executable?: ResolvedCommand;
  /** An already finished look-up (the adapter keeps its result for spawning). */
  lookup?: ExecutableLookup;
  /** Options for `findExecutable` (tests). */
  locate?: LocateOptions;
  timeoutMs?: number;
}

/** Find `name` for detection: a given copy is checked like any other. Never throws. */
export async function lookupForDetect(
  name: string,
  opts: DetectExeOptions,
): Promise<ExecutableLookup> {
  if (opts.lookup) return opts.lookup;
  if (opts.executable) {
    const result = await runsVersion(opts.executable, opts.timeoutMs);
    return result.ok
      ? { command: opts.executable, version: result.version, broken: [] }
      : { version: null, broken: [{ path: opts.executable.path, reason: result.reason }] };
  }
  return findExecutable(name, { timeoutMs: opts.timeoutMs, ...opts.locate });
}

const SHIM = /\.(cmd|bat|ps1)$/i;

/**
 * "Claude Code is installed but broken: `C:\...\npm\claude.cmd` points at a missing package.
 * Reinstall it, or remove the leftover shim." Names the first broken copy; the rest are in
 * the status's `broken` list.
 */
export function brokenInstallMessage(label: string, broken: readonly BrokenExecutable[]): string {
  const [first, ...rest] = broken;
  if (!first) return `${label} is installed but broken.`;
  const more = rest.length > 0 ? ` (and ${rest.length} more)` : "";
  const leftover =
    SHIM.test(path.win32.basename(first.path)) || first.reason === "points at a missing file";
  return `${label} is installed but broken: \`${first.path}\` ${first.reason}${more}. ${
    leftover ? "Reinstall it, or remove the leftover shim." : "Reinstall it."
  }`;
}
