/**
 * The `codeden` launcher (§16): runs first in every copy of the CLI (npx cache, global install,
 * a side-by-side version or a repository build). When `<home>/app/current.json` names a valid
 * installed version newer than this copy, that version's CLI is loaded in this same process
 * (same arguments, environment, signals and exit code; no extra process). Builds from a source
 * checkout never switch.
 *
 * Only Node built-ins here: it runs before the rest of the bundle loads, and must stay small.
 * `current.json` is parsed by hand; it must accept everything `AppPointer` in
 * `@codeden/contracts` accepts (a test checks both against the server's writer).
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/** How the running CLI was launched; set on `globalThis` for the rest of the bundle. */
export interface LaunchInfo {
  /** The `codeden` copy the user ran. */
  binEntry: string;
  binVersion: string;
  /** `npx`, a global or local npm install, or a source checkout. */
  kind: "npx" | "npm" | "managed" | "source";
  source: "packaged" | "source";
  /** What to type to start CodeDen again, e.g. `npx codeden`. */
  restartCommand: string;
  home: string;
  /** Set when the pinned version could not be started and this copy runs instead. */
  warning: string | null;
}

export const LAUNCH_KEY = "__CODEDEN_LAUNCH__";
/** Environment variable a restart passes the original `LaunchInfo` (JSON) in. */
export const LAUNCHED_BY_ENV = "CODEDEN_LAUNCHED_BY";
export const VERSION_KEY = "__CODEDEN_PACKAGE_VERSION__";

export type LaunchDecision =
  | { kind: "self"; warning: string | null }
  | { kind: "switch"; version: string; entry: string };

/** The data directory, resolved like `resolveHome` in the server (`--home`, CODEDEN_HOME, ~). */
export function homeFromArgs(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--home" && args[i + 1]) return resolve(args[i + 1] as string);
    if (arg.startsWith("--home=")) return resolve(arg.slice("--home=".length));
  }
  return env.CODEDEN_HOME ? resolve(env.CODEDEN_HOME) : join(homedir(), ".codeden");
}

/** A repository or workspace build: the package root next to `dist/` still has `src/`. */
export function isSourceCheckout(entry: string): boolean {
  const root = dirname(dirname(realEntry(entry)));
  return existsSync(join(root, "src", "cli.ts")) || existsSync(join(root, "tsdown.config.ts"));
}

/** How this copy was installed, from its path. */
export function installKind(entry: string, home: string): LaunchInfo["kind"] {
  const real = realEntry(entry);
  if (isSourceCheckout(real)) return "source";
  if (real.startsWith(join(realHome(home), "app") + sep)) return "managed";
  if (real.includes(`${sep}_npx${sep}`)) return "npx";
  return "npm";
}

/** The pinned version from `current.json`, or null when missing or unreadable. */
export function readPinnedVersion(home: string): string | null {
  try {
    const value = JSON.parse(readFileSync(join(home, "app", "current.json"), "utf8")) as {
      version?: unknown;
    };
    const version = value.version;
    return typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
      ? version
      : null;
  } catch {
    return null;
  }
}

/** The CLI entry of an installed version. */
export function managedEntry(home: string, version: string): string {
  return join(home, "app", version, "node_modules", "codeden", "dist", "cli.js");
}

/** Why the installed `version` can't start, or null when it looks complete. */
export function managedProblem(home: string, version: string): string | null {
  const root = join(home, "app", version, "node_modules", "codeden");
  let pkgVersion: unknown;
  try {
    pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  } catch {
    return "its package.json is missing";
  }
  if (pkgVersion !== version) return `its package.json says ${String(pkgVersion)}`;
  if (!existsSync(join(root, "dist", "cli.js"))) return "dist/cli.js is missing";
  return null;
}

/**
 * Decide whether to run this copy or switch to the pinned version. Never switches from a
 * source checkout, when `CODEDEN_NO_SWITCH=1`, when this copy was itself switched to, or to a
 * version that is not newer than this copy (a newer global install wins over an old pin).
 */
export function decideLaunch(input: {
  selfEntry: string;
  selfVersion: string;
  home: string;
  env?: NodeJS.ProcessEnv;
  alreadyLaunched?: boolean;
}): LaunchDecision {
  const env = input.env ?? process.env;
  const self = { kind: "self", warning: null } as const;
  if (env.CODEDEN_NO_SWITCH === "1" || input.alreadyLaunched) return self;
  if (isSourceCheckout(input.selfEntry)) return self;
  const pinned = readPinnedVersion(input.home);
  if (!pinned || compareCore(pinned, input.selfVersion) <= 0) return self;
  const entry = managedEntry(input.home, pinned);
  if (samePath(entry, input.selfEntry)) return self;
  const problem = managedProblem(input.home, pinned);
  if (problem) {
    return {
      kind: "self",
      warning:
        `CodeDen ${pinned} in ${join(input.home, "app", pinned)} can't start (${problem}); ` +
        `running ${input.selfVersion} instead. Run \`codeden update\` to reinstall it.`,
    };
  }
  return { kind: "switch", version: pinned, entry };
}

/**
 * The copy the user originally launched, passed (as JSON in `CODEDEN_LAUNCHED_BY`) to a version
 * started by a restart, so "Roll back" and the manual restart command still refer to it.
 */
export function parseLaunchedBy(raw: string | undefined, home: string): LaunchInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LaunchInfo>;
    if (typeof v.binEntry !== "string" || typeof v.binVersion !== "string") return null;
    if (v.kind !== "npx" && v.kind !== "npm" && v.kind !== "managed") return null;
    return {
      binEntry: v.binEntry,
      binVersion: v.binVersion,
      kind: v.kind,
      source: "packaged",
      restartCommand: restartCommandFor(v.kind, v.binEntry),
      home,
      warning: null,
    };
  } catch {
    return null;
  }
}

/** The command that starts this copy again. */
export function restartCommandFor(kind: LaunchInfo["kind"], entry: string): string {
  if (kind === "npx") return "npx codeden";
  if (kind === "source") return `node ${entry}`;
  return "codeden";
}

/** `x.y.z[-pre]` comparison (same rules as `compareVersions` in contracts). */
export function compareCore(a: string, b: string): number {
  const parse = (v: string) => {
    const dash = v.indexOf("-");
    const core = dash === -1 ? v : v.slice(0, dash);
    return {
      nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0),
      pre: dash === -1 ? "" : v.slice(dash + 1),
    };
  };
  const x = parse(a.replace(/^v/, ""));
  const y = parse(b.replace(/^v/, ""));
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const xs = x.pre.split(".");
  const ys = y.pre.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const p = xs[i];
    const q = ys[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function realEntry(entry: string): string {
  try {
    return realpathSync.native(entry);
  } catch {
    return resolve(entry);
  }
}

function realHome(home: string): string {
  try {
    return realpathSync.native(home);
  } catch {
    return resolve(home);
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === "win32" ? realEntry(p).toLowerCase() : realEntry(p);
  return norm(a) === norm(b);
}
