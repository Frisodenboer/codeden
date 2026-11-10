import { statSync } from "node:fs";
import type { BrokenExecutable } from "@codeden/contracts";
import {
  classify,
  pathCandidates,
  type ResolvedCommand,
  type ResolveOptions,
  runCommand,
} from "./exec";
import { type KnownLocationOptions, knownLocations } from "./known-locations";
import { inspectFile } from "./shim";
import { parseVersion } from "./version";

/** What looking for a tool found (§14). */
export interface ExecutableLookup {
  /** The first copy that runs; absent when none does. */
  command?: ResolvedCommand;
  /** From the working copy's `--version`. */
  version: string | null;
  /** Copies found before the working one (or all of them) that do not run. */
  broken: BrokenExecutable[];
}

/** Result of checking that a copy runs. */
export type Validation =
  | { ok: true; version: string | null }
  /** `retry`: a transient failure (a timeout) that is not cached. */
  | { ok: false; reason: string; retry?: boolean };

export interface LocateOptions extends ResolveOptions, KnownLocationOptions {
  /** Folders' files to try after PATH (default: `knownLocations(name)`). */
  knownLocations?: readonly string[];
  /** Check one copy (default: `--version` must exit 0 and print a version). */
  validate?: (command: ResolvedCommand) => Promise<Validation>;
  /** Per-copy `--version` timeout (default 8s). */
  timeoutMs?: number;
}

/**
 * Every file worth looking at for `name`, in order: PATH (with PATHEXT, then `.ps1` shims on
 * Windows, which are only inspected), then the tool's known install locations.
 */
function candidateFiles(name: string, opts: LocateOptions): string[] {
  const win = (opts.platform ?? process.platform) === "win32";
  const files = [
    ...pathCandidates(name, opts, win ? [".ps1"] : []),
    ...(opts.knownLocations ?? knownLocations(name, opts)),
  ];
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = win ? file.toLowerCase() : file;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The first copy of `name` that looks runnable, without running anything: PATH first, then
 * known install locations; broken shims, dangling links and copies whose last `--version`
 * check failed (until they change) are skipped. For callers that need an answer
 * synchronously; `findExecutable` also checks that the copy actually runs.
 */
export function quickLocate(name: string, opts: LocateOptions = {}): ResolvedCommand | undefined {
  const win = (opts.platform ?? process.platform) === "win32";
  for (const file of candidateFiles(name, opts)) {
    const seen = inspectFile(file, win);
    if (seen.kind !== "candidate") continue;
    const key = cacheKey([file, seen.target]);
    if (key !== undefined && cache.get(key)?.ok === false) continue;
    return classify(file, win);
  }
  return undefined;
}

/**
 * Find a copy of `name` that really runs (§14). Looks on PATH, then in the tool's known
 * install locations; each copy is inspected (a shim's package must exist) and then run with
 * `--version`. Broken copies are skipped and reported, so a working native install wins over
 * a leftover npm shim earlier on PATH. Results are cached per file and modification time.
 * Never throws.
 */
export async function findExecutable(
  name: string,
  opts: LocateOptions = {},
): Promise<ExecutableLookup> {
  const win = (opts.platform ?? process.platform) === "win32";
  const broken: BrokenExecutable[] = [];
  for (const file of candidateFiles(name, opts)) {
    const seen = inspectFile(file, win);
    if (seen.kind === "absent" || seen.kind === "skip") continue;
    if (seen.kind === "broken") {
      broken.push(seen.broken);
      continue;
    }
    const command = classify(file, win);
    const result = await validateCached(command, [file, seen.target], opts);
    if (result.ok) return { command, version: result.version, broken };
    broken.push({ path: file, reason: result.reason });
  }
  return { version: null, broken };
}

const cache = new Map<string, Validation>();

/** Forget cached `--version` results (tests). */
export function clearExecutableCache(): void {
  cache.clear();
}

/** The file plus what it launches, by modification time and size: a reinstall changes it. */
function cacheKey(files: (string | undefined)[]): string | undefined {
  const parts: string[] = [];
  for (const file of files) {
    if (!file) continue;
    try {
      const stat = statSync(file);
      parts.push(`${file}|${stat.mtimeMs}|${stat.size}`);
    } catch {
      return undefined;
    }
  }
  return parts.join("\n");
}

async function validateCached(
  command: ResolvedCommand,
  files: (string | undefined)[],
  opts: LocateOptions,
): Promise<Validation> {
  const key = cacheKey(files);
  const hit = key === undefined ? undefined : cache.get(key);
  if (hit) return hit;
  const result = await (opts.validate ?? ((c) => runsVersion(c, opts.timeoutMs)))(command);
  if (key !== undefined && (result.ok || !result.retry)) cache.set(key, result);
  return result;
}

/** `<tool> --version` must exit 0 and print a version. */
export async function runsVersion(
  command: ResolvedCommand,
  timeoutMs = 8_000,
): Promise<Validation> {
  const run = await runCommand(command, ["--version"], { timeoutMs });
  if (run.error) return { ok: false, reason: `could not be started (${run.error.message})` };
  if (run.timedOut) {
    return {
      ok: false,
      reason: `did not answer \`--version\` within ${Math.round(timeoutMs / 1000)}s`,
      retry: true,
    };
  }
  if (run.code !== 0) {
    const why = firstLine(run.stderr) || firstLine(run.stdout);
    return {
      ok: false,
      reason: `exited with code ${run.code} on \`--version\`${why ? ` (${why})` : ""}`,
    };
  }
  const version = parseVersion(run.stdout) ?? parseVersion(run.stderr);
  if (!version) return { ok: false, reason: "printed no version for `--version`" };
  return { ok: true, version };
}

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
