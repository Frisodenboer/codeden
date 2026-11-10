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
  if (sub === "config" && rest.includes("--global")) {
    return risky("outside_worktree", "Changes global git configuration");
  }
  return SAFE;
}
