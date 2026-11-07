import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

/**
 * Claude Code's folder name for a project under `~/.claude/projects/`: every character that
 * is not an ASCII letter or digit becomes `-` (`C:\Projects\codeden` -> `C--Projects-codeden`,
 * `C:\Users\me\.cfg` -> `C--Users-me--cfg`). Verified against real folder names on Windows.
 */
export function claudeProjectSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * The project's Claude auto-memory folder (§12.4): `autoMemoryDirectory` from the user's
 * `~/.claude/settings.json` when set, else `~/.claude/projects/<slug>/memory`. The slug comes
 * from the git repository root, so every worktree of a repo shares one folder. Very long
 * slugs are shortened by Claude Code; an existing folder with the same prefix is used then.
 */
export function claudeAutoMemoryDir(home: string, repoRoot: string): string {
  const custom = readJson(join(home, ".claude", "settings.json"))?.autoMemoryDirectory;
  if (typeof custom === "string" && custom.trim()) {
    const value = custom.trim();
    return value.startsWith("~/") || value.startsWith("~\\")
      ? join(home, value.slice(2))
      : resolve(value);
  }
  const projects = join(home, ".claude", "projects");
  const slug = claudeProjectSlug(repoRoot);
  const direct = join(projects, slug);
  if (slug.length > 200 && !existsSync(direct) && existsSync(projects)) {
    const prefix = slug.slice(0, 200).toLowerCase();
    const match = readdirSync(projects).find((name) => name.toLowerCase().startsWith(prefix));
    if (match) return join(projects, match, "memory");
  }
  return join(direct, "memory");
}

/** Nearest ancestor (or `dir` itself) containing `.git` (a folder, or a file in worktrees). */
export function findGitRoot(dir: string): string | null {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The main checkout of a worktree (`.git` file -> `gitdir: <main>/.git/worktrees/x`). */
export function mainRepoRoot(gitRoot: string): string {
  const marker = join(gitRoot, ".git");
  try {
    if (!statSync(marker).isFile()) return gitRoot;
    const line = readFileSync(marker, "utf8").trim();
    const gitdir = /^gitdir:\s*(.+)$/m.exec(line)?.[1];
    if (!gitdir) return gitRoot;
    const absolute = resolve(gitRoot, gitdir);
    const at = absolute.split(sep).lastIndexOf("worktrees");
    if (at < 1) return gitRoot;
    return dirname(absolute.split(sep).slice(0, at).join(sep));
  } catch {
    return gitRoot;
  }
}

/** `dir` and its ancestors, nearest first, up to the filesystem root. */
export function ancestors(dir: string): string[] {
  const out: string[] = [];
  let current = resolve(dir);
  for (;;) {
    out.push(current);
    const parent = dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

/** Directories from `root` down to `cwd` (inclusive); just `[cwd]` when cwd is not inside. */
export function dirsFromRootTo(root: string, cwd: string): string[] {
  const rel = relative(root, cwd);
  if (rel.startsWith("..") || parse(rel).root) return [resolve(cwd)];
  const parts = rel ? rel.split(sep) : [];
  return [resolve(root), ...parts.map((_, i) => join(root, ...parts.slice(0, i + 1)))];
}

/** `/`-separated path of `path` relative to `root`. */
export function toRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

export function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** `name` and `description` from a markdown file's YAML front matter (simple keys only). */
export function frontMatter(file: string): { name?: string; description?: string } {
  let text: string;
  try {
    text = readFileSync(file, "utf8").slice(0, 8_000);
  } catch {
    return {};
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!block) return {};
  const out: { name?: string; description?: string } = {};
  for (const key of ["name", "description"] as const) {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(block);
    const value = m?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (value && value !== ">" && value !== "|") out[key] = value;
  }
  return out;
}
