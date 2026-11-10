import { type RiskAssessment, risky, SAFE } from "./assessment";

/** Git rules of the risk classifier (§11.2): force pushes, deleting refs, global config. */
export function classifyGit(args: string[]): RiskAssessment {
  // Skip global options like `-C dir` / `-c k=v`.
  let i = 0;
  while (i < args.length && args[i]?.startsWith("-"))
    i += args[i] === "-c" || args[i] === "-C" ? 2 : 1;
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === "push") {
    if (
      rest.some(
        (a) =>
          a === "--force" ||
          a === "-f" ||
          a.startsWith("--force-with-lease") ||
          a === "--mirror" ||
          /^-[a-z]*f[a-z]*$/.test(a),
      )
    ) {
      return risky("git_destructive", "Force-pushes, which can overwrite remote history");
    }
    if (rest.some((a) => a.startsWith("+") && a.length > 1)) {
      return risky("git_destructive", "Force-pushes a refspec");
    }
    if (
      rest.includes("--delete") ||
      rest.includes("-d") ||
      rest.some((a) => a.startsWith(":") && a.length > 1)
    ) {
      return risky("git_destructive", "Deletes a remote branch");
    }
  }
  if (
    sub === "branch" &&
    rest.some((a) => a === "-d" || a === "-D" || a === "--delete" || /^-[a-z]*d/i.test(a))
  ) {
    return risky("git_destructive", "Deletes a branch");
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
function writesConfig(rest: string[]): boolean {
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
