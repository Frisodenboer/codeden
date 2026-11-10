import { type RiskAssessment, risky, SAFE } from "./assessment";

/** What the git rules know about the session. */
export interface GitContext {
  /** The branch the session owns (SessionOptions.ownBranch). */
  ownBranch?: string;
  /** The branch checked out in the worktree, read when needed. */
  currentBranch?: () => string | undefined;
  /** True when the command runs in the session's worktree (not `cd`'d or `-C`'d elsewhere). */
  inWorktree: boolean;
}

/**
 * Git rules of the risk classifier (§11.2): force pushes, deleting refs, global config. `args`
 * keep their case (`-D` is not `-d`, branch names are case-sensitive).
 */
export function classifyGit(
  args: string[],
  ctx: GitContext = { inWorktree: false },
): RiskAssessment {
  // Skip global options like `-C dir` / `-c k=v`; another directory is not the worktree.
  let i = 0;
  let elsewhere = false;
  while (i < args.length && args[i]?.startsWith("-")) {
    const option = args[i] as string;
    if (option === "-C" || option.startsWith("--git-dir") || option.startsWith("--work-tree")) {
      elsewhere = true;
    }
    i +=
      option === "-c" || option === "-C" || option === "--git-dir" || option === "--work-tree"
        ? 2
        : 1;
  }
  const sub = args[i]?.toLowerCase();
  const raw = args.slice(i + 1);
  const rest = raw.map((a) => a.toLowerCase());
  if (sub === "push") {
    return classifyPush(raw, { ...ctx, inWorktree: ctx.inWorktree && !elsewhere });
  }
  if (sub === "branch" && deletesUnmerged(raw)) {
    return risky("git_destructive", "Deletes a branch with unmerged work (-D)");
  }
  if (sub === "tag" && rest.some((a) => a === "-d" || a === "--delete")) {
    return risky("git_destructive", "Deletes a tag");
  }
  if (sub === "update-ref" && rest.includes("-d")) return risky("git_destructive", "Deletes a ref");
  if (sub === "config" && (rest.includes("--global") || rest.includes("--system"))) {
    if (writesConfig(rest)) return risky("outside_worktree", "Changes global git configuration");
  }
  return SAFE;
}

/**
 * `git branch` deleting without the merged check: `-D`, or `-d`/`--delete` with `--force`.
 * A plain `-d` refuses to delete unmerged work, so it is safe.
 */
function deletesUnmerged(args: string[]): boolean {
  const short = args.filter((a) => /^-[a-zA-Z]+$/.test(a));
  if (short.some((a) => a.includes("D"))) return true;
  const deletes = args.includes("--delete") || short.some((a) => a.includes("d"));
  const force = args.includes("--force") || short.some((a) => a.includes("f"));
  return deletes && force;
}

/** `git push` options that take the next word as their value. */
const PUSH_VALUED = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/**
 * Force pushes and remote deletions ask. A force push with a lease (`--force-with-lease`) of
 * the session's own branch doesn't: it only rewrites the session's own work, and the lease
 * refuses if someone else pushed there since.
 */
function classifyPush(args: string[], ctx: GitContext): RiskAssessment {
  const flags = args.filter((a) => a.startsWith("-")).map((a) => a.toLowerCase());
  const operands = args.filter((a, i) => !a.startsWith("-") && !PUSH_VALUED.has(args[i - 1] ?? ""));
  if (operands.some((a) => a.startsWith("+") && a.length > 1)) {
    return risky("git_destructive", "Force-pushes a refspec");
  }
  if (
    flags.includes("--delete") ||
    flags.includes("-d") ||
    operands.some((a) => a.startsWith(":") && a.length > 1)
  ) {
    return risky("git_destructive", "Deletes a remote branch");
  }
  const hard = flags.some((a) => a === "--force" || a === "--mirror" || /^-[a-z]*f[a-z]*$/.test(a));
  const lease = flags.some((a) => a.startsWith("--force-with-lease"));
  if (hard || (lease && !pushesOwnBranch(flags, operands.slice(1), ctx))) {
    return risky("git_destructive", "Force-pushes, which can overwrite remote history");
  }
  return SAFE;
}

/** True when every ref the push updates is the session's own branch. */
function pushesOwnBranch(flags: string[], refspecs: string[], ctx: GitContext): boolean {
  const own = ctx.ownBranch;
  if (!own || !ctx.inWorktree) return false;
  if (flags.some((a) => ["--all", "--branches", "--tags", "--mirror", "--prune"].includes(a))) {
    return false;
  }
  const current = () => ctx.currentBranch?.();
  if (refspecs.length === 0) return current() === own;
  return refspecs.every((spec) => {
    const [src = "", dst] = spec.split(":");
    const target = (dst ?? (src === "HEAD" || src === "@" ? current() : src))?.replace(
      /^refs\/heads\//,
      "",
    );
    return target === own;
  });
}

/** `git config` options and subcommands that change the configuration. */
const CONFIG_WRITES = new Set([
  "--unset",
  "--unset-all",
  "--add",
  "--replace-all",
  "--edit",
  "-e",
  "--rename-section",
  "--remove-section",
  "set",
  "unset",
  "edit",
  "rename-section",
  "remove-section",
]);
/** `git config` options and subcommands that only read. */
const CONFIG_READS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--get-urlmatch",
  "--get-color",
  "--get-colorbool",
  "--list",
  "-l",
  "get",
  "list",
]);
/** `git config` options that take the next word as their value. */
const CONFIG_VALUED = new Set(["--type", "--default", "--file", "-f", "--blob", "--comment"]);

/**
 * True when `git config <rest>` changes something: a writing option or subcommand, or a name
 * and a value (`git config --global user.name x`). A bare name reads it.
 */
export function writesConfig(rest: string[]): boolean {
  const positional = rest.filter(
    (a, i) => !a.startsWith("-") && !CONFIG_VALUED.has(rest[i - 1] ?? ""),
  );
  // Subcommands (`git config get x`) come first; a later `list` is a value.
  const named = (set: Set<string>) =>
    rest.some((a) => a.startsWith("-") && set.has(a)) || set.has(positional[0] ?? "");
  if (named(CONFIG_WRITES)) return true;
  if (named(CONFIG_READS)) return false;
  return positional.length !== 1;
}
