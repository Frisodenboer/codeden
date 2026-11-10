import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/**
 * Where Claude Code keeps its own notes outside the worktree: plan files (plan mode) and the
 * project's auto-memory. Writing them is Claude's own bookkeeping, so the risk policy treats
 * them like the temp directory under Auto and Full (§11.2). Only the user's own settings may
 * move them; a repository's settings can't point them elsewhere.
 */

/**
 * Claude Code's folder name for a project under `~/.claude/projects/`: every character that
 * is not an ASCII letter or digit becomes `-` (`C:\Projects\codeden` -> `C--Projects-codeden`,
 * `C:\Users\me\.cfg` -> `C--Users-me--cfg`). Verified against real folder names on Windows.
 */
export function claudeProjectSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A string setting from Claude's user `settings.json` in `configDir`, trimmed. */
function userSetting(configDir: string, key: string): string | undefined {
  const value = readJsonObject(join(configDir, "settings.json"))?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `~/x` against `home`, absolute paths as they are, anything else against `base`. */
function expand(value: string, home: string, base: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

/**
 * The project's Claude auto-memory folder (§12.4): `autoMemoryDirectory` from the user's
 * settings in `configDir` (`~/.claude`) when set, else `<configDir>/projects/<slug>/memory`.
 * The slug comes from the git repository root, so every worktree of a repo shares one folder.
 * Very long slugs are shortened by Claude Code; an existing folder with the same prefix is used
 * then.
 */
export function claudeMemoryDir(
  configDir: string,
  repoRoot: string,
  home = dirname(configDir),
): string {
  const custom = userSetting(configDir, "autoMemoryDirectory");
  if (custom) return expand(custom, home, process.cwd());
  const projects = join(configDir, "projects");
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

/** True when `target` is `root` or inside it (case-insensitive on Windows). */
function within(target: string, root: string): boolean {
  const norm = (p: string) =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  const rel = relative(norm(root), norm(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Claude's notes folders for a session in `cwd`: its plans folder (`plansDirectory`, default
 * `<configDir>/plans`) and the project's auto-memory folder. A folder is dropped when it would
 * cover Claude's config folder itself (its settings and credentials), the home directory or a
 * filesystem root.
 */
export function claudeNotesDirs(options: {
  cwd: string;
  home: string;
  /** Claude's config folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  configDir?: string;
}): string[] {
  const { cwd, home } = options;
  const configDir = options.configDir ?? join(home, ".claude");
  const plans = userSetting(configDir, "plansDirectory");
  const dirs = [
    plans ? expand(plans, home, cwd) : join(configDir, "plans"),
    claudeMemoryDir(configDir, mainRepoRoot(findGitRoot(cwd) ?? cwd), home),
  ];
  return dirs.filter(
    (dir) => parse(dir).root !== dir && !within(home, dir) && !within(configDir, dir),
  );
}
