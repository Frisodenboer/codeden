import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PackageManager, ProjectDetection } from "@codeden/contracts";
import { badRequest } from "../errors";
import type { Exec } from "../exec";

/** Remove credentials embedded in URLs (`https://user:token@host`). */
export function redactUrls(text: string): string {
  return text.replace(/(\w+:\/\/)[^@\s/]+@/g, "$1***@");
}

/** `owner/repo` from a GitHub remote URL (https, ssh or scp-style); null for other hosts. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const patterns = [
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(trimmed);
    if (m?.[1] && m[2]) return { owner: m[1], repo: m[2] };
  }
  return null;
}

/**
 * Validate a clone source. Accepts GitHub URLs, `owner/repo` shorthand (expanded to an https
 * GitHub URL) and other git URLs (https, ssh, file). Never anything that git could read as an
 * option.
 */
export function normalizeCloneUrl(input: string): { url: string; name: string } {
  const value = input.trim();
  if (!value || value.startsWith("-") || /\s/.test(value)) {
    throw badRequest("Enter a git URL or owner/repo", "invalid_clone_url");
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) {
    const [owner, repo] = value.split("/") as [string, string];
    const cleanRepo = repo.replace(/\.git$/, "");
    return { url: `https://github.com/${owner}/${cleanRepo}.git`, name: cleanRepo };
  }
  if (!/^(https?:\/\/|ssh:\/\/|git@[\w.-]+:|file:\/\/)/i.test(value)) {
    throw badRequest("Unsupported clone URL", "invalid_clone_url");
  }
  const last = value.replace(/\/+$/, "").split(/[/:]/).at(-1) ?? "";
  const name = last.replace(/\.git$/i, "");
  if (!name) throw badRequest("Cannot work out the repository name", "invalid_clone_url");
  return { url: value, name };
}

/** Package manager from lock files, then `package.json#packageManager`. */
export function detectPackageManager(dir: string): PackageManager | null {
  const locks: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, pm] of locks) if (existsSync(join(dir, file))) return pm;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      packageManager?: unknown;
    };
    if (typeof pkg.packageManager === "string") {
      const name = pkg.packageManager.split("@")[0];
      if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") return name;
    }
    return "npm";
  } catch {
    return null;
  }
}

/** Worktree setup commands to suggest for a package manager (§14 step 5). */
export function suggestedSetup(pm: PackageManager | null): string[] {
  return pm ? [`${pm} install`] : [];
}

/** True when `path` exists and is a directory. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether two paths name the same folder, following symlinks (macOS `/var` → `/private/var`)
 * and ignoring case on Windows.
 */
export function sameRealPath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  const [x, y] = [real(a), real(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

async function git(exec: Exec, cwd: string, args: string[]): Promise<string | null> {
  const result = await exec("git", ["-C", cwd, ...args], { timeoutMs: 10_000 });
  return result.code === 0 ? result.stdout.trim() || null : null;
}

/** Inspect a folder: git checkout, remote, GitHub coordinates, branches, package manager. */
export async function detectProject(exec: Exec, dir: string): Promise<ProjectDetection> {
  const root = await git(exec, dir, ["rev-parse", "--show-toplevel"]);
  const packageManager = detectPackageManager(dir);
  const base: ProjectDetection = {
    isGitRepo: root !== null,
    gitRoot: root ? resolve(root) : null,
    remoteUrl: null,
    github: null,
    defaultBranch: null,
    currentBranch: null,
    packageManager,
    suggestedSetupCommands: suggestedSetup(packageManager),
  };
  if (!root) return base;

  const [rawRemote, originHead, current] = await Promise.all([
    git(exec, dir, ["remote", "get-url", "origin"]),
    git(exec, dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
    git(exec, dir, ["symbolic-ref", "--short", "HEAD"]),
  ]);
  // A token embedded in the remote URL must never reach the event log or the UI.
  const remoteUrl = rawRemote ? redactUrls(rawRemote) : null;
  const defaultBranch = originHead?.replace(/^origin\//, "") ?? current;
  const gh = remoteUrl ? parseGitHubRemote(remoteUrl) : null;
  return {
    ...base,
    remoteUrl,
    currentBranch: current,
    defaultBranch,
    github: gh && remoteUrl ? { ...gh, remoteUrl, defaultBranch: defaultBranch ?? "main" } : null,
  };
}
