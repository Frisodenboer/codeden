import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AppPointer, compareVersions, type InstalledVersion } from "@codeden/contracts";
import { readJsonFile, writeJsonFile } from "../../json-file";

/**
 * Side-by-side CodeDen installs (§16): `<home>/app/<version>/node_modules/codeden` per version
 * and `<home>/app/current.json` naming the one the `codeden` launcher starts. A running
 * version's files are never touched (Windows locks loaded native modules), so updates always
 * go into a new folder and old ones are pruned once nothing runs from them.
 */
export const PACKAGE_NAME = "codeden";

/** Version folder names npm can install: `x.y.z` with an optional prerelease/build tag. */
const VERSION_DIR = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function appDir(home: string): string {
  return join(home, "app");
}

export function pointerFile(home: string): string {
  return join(appDir(home), "current.json");
}

export function versionDir(home: string, version: string): string {
  return join(appDir(home), version);
}

/** The installed package root for `version`. */
export function packageRoot(home: string, version: string): string {
  return join(versionDir(home, version), "node_modules", PACKAGE_NAME);
}

/** The CLI entry of `version` (what the launcher imports and a restart spawns). */
export function cliEntry(home: string, version: string): string {
  return join(packageRoot(home, version), "dist", "cli.js");
}

/** True for a folder name or version string that can safely be used as a path segment. */
export function isVersionName(name: string): boolean {
  return VERSION_DIR.test(name);
}

/** Why the install of `version` in `root` can't run, or null when it looks complete. */
export function installProblem(root: string, version: string): string | null {
  let pkgVersion: unknown;
  try {
    pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  } catch {
    return "its package.json is missing";
  }
  if (pkgVersion !== version) return `its package.json says ${String(pkgVersion)}`;
  for (const file of ["dist/cli.js", "dist/runner.js", "dist/web/index.html"]) {
    if (!existsSync(join(root, file))) return `${file} is missing`;
  }
  return null;
}

export function readPointer(home: string): AppPointer | null {
  const parsed = AppPointer.safeParse(readJsonFile(pointerFile(home)));
  return parsed.success && isVersionName(parsed.data.version) ? parsed.data : null;
}

export function writePointer(home: string, version: string, previous: string | null): AppPointer {
  const pointer: AppPointer = { version, previous, updatedAt: new Date().toISOString() };
  writeJsonFile(pointerFile(home), pointer);
  return pointer;
}

/** Forget the pinned version: the launcher starts the copy you ran. */
export function clearPointer(home: string): void {
  rmSync(pointerFile(home), { force: true });
}

/** Versions installed in `<home>/app`, newest first. */
export function listInstalled(home: string): InstalledVersion[] {
  let names: string[];
  try {
    names = readdirSync(appDir(home)).filter(isVersionName);
  } catch {
    return [];
  }
  const current = readPointer(home)?.version;
  return names
    .sort((a, b) => compareVersions(b, a))
    .map((version) => ({
      version,
      current: version === current,
      valid: installProblem(packageRoot(home, version), version) === null,
    }));
}

/**
 * Delete installed versions other than the pinned one, its `previous` and `keep` (the running
 * version), so at most the last two stay for rollback. Folders still in use (Windows file
 * locks) are skipped and retried next time. Also clears abandoned staging folders.
 */
export function pruneInstalled(home: string, keep: string[] = []): string[] {
  const pointer = readPointer(home);
  const kept = new Set([pointer?.version, pointer?.previous, ...keep].filter(Boolean));
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(appDir(home));
  } catch {
    return removed;
  }
  for (const name of names) {
    const stale = name.startsWith(".staging-") && !isLiveStaging(name);
    if (!stale && (!isVersionName(name) || kept.has(name))) continue;
    try {
      rmSync(join(appDir(home), name), { recursive: true, force: true, maxRetries: 2 });
      if (!stale) removed.push(name);
    } catch {
      // In use (a process still runs from it): leave it for the next prune.
    }
  }
  return removed;
}

/** `.staging-<version>-<pid>` folders belong to a live install while that process runs. */
function isLiveStaging(name: string): boolean {
  const pid = Number(name.slice(name.lastIndexOf("-") + 1));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * What "Roll back" starts: the pointer's `previous` when it is a valid install newer than the
 * copy you launched, otherwise `null` (clear the pointer and run the launched copy).
 */
export function rollbackTarget(home: string, launcherVersion: string): string | null {
  const previous = readPointer(home)?.previous;
  if (!previous || !isVersionName(previous)) return null;
  if (installProblem(packageRoot(home, previous), previous)) return null;
  return compareVersions(previous, launcherVersion) > 0 ? previous : null;
}

/**
 * Point the launcher back at the previous version (or at the launched copy). Returns the
 * version that will start next, or null when there is nothing to roll back to.
 */
export function applyRollback(
  home: string,
  launcherVersion: string,
): { next: string; pinned: boolean } | null {
  const pointer = readPointer(home);
  if (!pointer) return null;
  const target = rollbackTarget(home, launcherVersion);
  if (target) {
    writePointer(home, target, pointer.version);
    return { next: target, pinned: true };
  }
  clearPointer(home);
  return { next: launcherVersion, pinned: false };
}
