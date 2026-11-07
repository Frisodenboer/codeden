import { z } from "zod";
import { Timestamp } from "./common";

/**
 * `settings.updates.mode` (§16): `off` never asks the registry; `notify` checks and offers a
 * one-click update; `auto` also downloads a new version in the background so it starts on the
 * next launch (or right away with "Restart now").
 */
export const UpdateMode = z.enum(["off", "notify", "auto"]);
export type UpdateMode = z.infer<typeof UpdateMode>;

/**
 * Where the running CodeDen came from. `packaged`: an npm install (`npx`, global or a
 * side-by-side version in `<home>/app`), which can update itself. `source`: the repository or
 * a workspace build, which never switches versions (pull and rebuild instead).
 */
export const InstallSource = z.enum(["packaged", "source"]);
export type InstallSource = z.infer<typeof InstallSource>;

/**
 * Self-update progress. `installing`: npm is fetching `target` into `<home>/app/<target>`;
 * `installed`: it is ready and starts on the next launch (or with a restart); `restarting`:
 * the server is handing over to `target`; `failed`: see `installError`.
 */
export const UpdateState = z.enum(["idle", "installing", "installed", "restarting", "failed"]);
export type UpdateState = z.infer<typeof UpdateState>;

/** A CodeDen version installed side by side in `<home>/app/<version>`. */
export const InstalledVersion = z.object({
  version: z.string(),
  /** `<home>/app/current.json` points at it: the launcher starts it. */
  current: z.boolean(),
  /** The CLI entry exists and its package reports this version. */
  valid: z.boolean(),
});
export type InstalledVersion = z.infer<typeof InstalledVersion>;

/**
 * `GET /api/updates` (§16) and the `update` WebSocket message: the npm registry check plus the
 * one-click self-update state. The registry is asked on start and every 6 hours while the
 * mode is not `off`; `?refresh=1` checks again now. Nothing but the package name is sent.
 */
export const UpdateStatus = z.object({
  /** The running version. */
  current: z.string(),
  /** Latest published version, null until a check succeeded. */
  latest: z.string().nullable(),
  /** `latest` is newer than `current`. */
  updateAvailable: z.boolean(),
  /** The mode is not `off` (and `CODEDEN_UPDATE_CHECK` is not `0`); when false nothing is fetched. */
  enabled: z.boolean(),
  mode: UpdateMode,
  checkedAt: Timestamp.nullable(),
  /** Why the last check failed (offline, registry error), else null. */
  error: z.string().nullable(),
  /** The manual way to update, e.g. `npm i -g codeden@latest`. */
  command: z.string(),
  source: InstallSource,
  state: UpdateState,
  /** The version being installed, installed and waiting for a restart, or restarting into. */
  target: z.string().nullable(),
  /** The latest npm output line while installing. */
  progress: z.string().nullable(),
  /** Why the last install, switch or restart failed. */
  installError: z.string().nullable(),
  /** This server can restart itself into another version (started by the `codeden` CLI). */
  canRestart: z.boolean(),
  /** What to run to restart by hand when it can't, e.g. `npx codeden`. */
  restartCommand: z.string(),
  /** Versions in `<home>/app`, newest first. */
  installed: z.array(InstalledVersion),
  /** The version "Roll back" would start (the previous one, or the copy you launched). */
  rollbackTo: z.string().nullable(),
  /** "Roll back" is possible (a previous version is recorded). */
  canRollback: z.boolean(),
  /** Set when the launcher could not start the pinned version and fell back. */
  warning: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;

/** `POST /api/updates/install`: install `version` (default: the latest) and restart into it. */
export const UpdateInstallRequest = z.object({
  version: z.string().min(1).optional(),
  /** Restart once installed (default true); false leaves it for the next launch. */
  restart: z.boolean().optional(),
});
export type UpdateInstallRequest = z.infer<typeof UpdateInstallRequest>;

/** `GET /api/updates/notes?version=`: release notes for "What's new". */
export const ReleaseNotes = z.object({
  version: z.string(),
  /** Markdown from the GitHub Release body or the CHANGELOG section; null when unreachable. */
  body: z.string().nullable(),
  /** Where to read them in the browser. */
  url: z.string(),
});
export type ReleaseNotes = z.infer<typeof ReleaseNotes>;

/**
 * `<home>/app/current.json`: which side-by-side version the `codeden` launcher starts. Written
 * by the server or `codeden update`; read (without zod, on the hot path) by the launcher in
 * `apps/cli/src/launcher.ts`, which must accept everything this schema accepts.
 */
export const AppPointer = z.object({
  version: z.string().min(1),
  /** The version that ran before the switch ("Roll back" target), null when unknown. */
  previous: z.string().nullable(),
  updatedAt: Timestamp,
});
export type AppPointer = z.infer<typeof AppPointer>;

/** True when version `a` is newer than `b` (`x.y.z`, prerelease tags sort before releases). */
export function isNewerVersion(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/** Compare two `x.y.z[-pre]` versions: negative when `a < b`, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const trimmed = v.trim().replace(/^v/, "");
    const dash = trimmed.indexOf("-");
    const core = dash === -1 ? trimmed : trimmed.slice(0, dash);
    const pre = dash === -1 ? "" : trimmed.slice(dash + 1);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // release beats prerelease
  if (!y.pre) return -1;
  return comparePrerelease(x.pre, y.pre);
}

/** Dot-separated prerelease identifiers: numeric ones compare as numbers and sort first. */
function comparePrerelease(a: string, b: string): number {
  const xs = a.split(".");
  const ys = b.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
