import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Local config a fresh worktree would otherwise miss: the project's uncommitted Claude settings
 * and its git-ignored override (often holding a provider key, e.g. `ANTHROPIC_AUTH_TOKEN`), and `.env`
 * files. Committed templates (`.env.example`, `.env.sample`, `.env.template`) are skipped:
 * git already checks them out.
 */
/** `.claude/settings.json` only lands here when it is not committed (a checked-out one exists). */
const FIXED = [".claude/settings.json", ".claude/settings.local.json"];
const ENV_FILE = /^\.env(\.[\w.-]+)?$/;
const TEMPLATE = /\.(example|sample|template|dist)$/i;
/** Never copy anything big by accident. */
const MAX_BYTES = 1024 * 1024;

function candidates(repo: string): string[] {
  let rootFiles: string[] = [];
  try {
    rootFiles = readdirSync(repo).filter((f) => ENV_FILE.test(f) && !TEMPLATE.test(f));
  } catch {
    rootFiles = [];
  }
  return [...FIXED, ...rootFiles];
}

/**
 * Copy the project's local config files from the main checkout into a new worktree. Only files
 * the worktree doesn't already have (so tracked files are never overwritten), only regular
 * files up to 1 MB. Returns the relative paths copied.
 */
export function copyLocalFiles(repo: string, worktree: string): string[] {
  const copied: string[] = [];
  for (const rel of candidates(repo)) {
    const from = join(repo, rel);
    const to = join(worktree, rel);
    try {
      if (!existsSync(from) || existsSync(to)) continue;
      const stat = statSync(from);
      if (!stat.isFile() || stat.size > MAX_BYTES) continue;
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied.push(rel);
    } catch {
      // A file we can't read or write is skipped; the session still starts.
    }
  }
  return copied;
}
