import { splitCommands, tokenize } from "./risk";

/**
 * Read-only sessions (the orchestrator and PMs, §11.2) may inspect a repository but never
 * change it. This allowlist decides which shell commands they may run: commands that only
 * read, with no output redirection and no command substitution. Anything else is denied.
 */

/** Programs that only read (or print). */
const READ_ONLY_BINS = new Set([
  "ls",
  "dir",
  "cat",
  "type",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "fd",
  "tree",
  "pwd",
  "echo",
  "printf",
  "which",
  "where",
  "whoami",
  "date",
  "stat",
  "file",
  "du",
  "df",
  "sort",
  "uniq",
  "cut",
  "diff",
  "jq",
  "basename",
  "dirname",
  "realpath",
  "true",
  "get-childitem",
  "gci",
  "get-content",
  "gc",
  "get-item",
  "gi",
  "get-location",
  "gl",
  "select-string",
  "sls",
  "measure-object",
  "test-path",
  "resolve-path",
  "write-output",
  "write-host",
  "select-object",
  "where-object",
  "format-list",
  "format-table",
  "out-string",
  "sort-object",
  "gh",
]);

/** Git subcommands that never change the repository. */
const READ_ONLY_GIT = new Set([
  "status",
  "log",
  "show",
  "diff",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "describe",
  "shortlog",
  "cat-file",
  "remote",
  "branch",
  "tag",
  "config",
  "reflog",
  "merge-base",
  "name-rev",
  "for-each-ref",
  "worktree",
]);

/** `gh` subcommand verbs that only read. */
const READ_ONLY_GH = new Set(["view", "list", "status", "diff", "checks"]);

const bin = (token: string | undefined): string =>
  (token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "") ?? "";

/** Why a command is refused in a read-only session, or undefined when it may run. */
export function readOnlyCommandDenial(command: string): string | undefined {
  if (/\$\(|`|<\(|>\(/.test(command)) {
    return "Command substitution is not allowed in a read-only session";
  }
  for (const simple of splitCommands(command)) {
    if (/(^|[^0-9&<])>>?(?!\s*(&\d|\/dev\/null|nul\b|\$null))/i.test(simple)) {
      return "Writing files is not allowed in a read-only session";
    }
    const tokens = tokenize(simple);
    const name = bin(tokens[0]);
    const args = tokens.slice(1).map((a) => a.toLowerCase());
    if (name === "git") {
      const sub = args.find((a) => !a.startsWith("-"));
      if (!sub || !READ_ONLY_GIT.has(sub)) return `git ${sub ?? ""} may change the repository`;
      if (
        (sub === "branch" || sub === "tag" || sub === "remote" || sub === "worktree") &&
        args.some((a) => /^-(d|D|m|M|f|-delete|-move|-force)$/.test(a) || a === "add")
      ) {
        return `git ${sub} with these options changes the repository`;
      }
      if (sub === "config" && !args.some((a) => a === "--get" || a === "--list" || a === "-l")) {
        return "Only reading git config is allowed";
      }
      continue;
    }
    if (name === "gh") {
      if (!args.some((a) => READ_ONLY_GH.has(a)) || args.includes("api")) {
        return "Only read-only gh commands are allowed (view, list, status, diff, checks)";
      }
      continue;
    }
    if (name === "find" && args.some((a) => a === "-delete" || a === "-exec" || a === "-execdir")) {
      return "find with -delete or -exec is not allowed in a read-only session";
    }
    if (!READ_ONLY_BINS.has(name)) {
      return `${name || "This command"} is not on the read-only allowlist`;
    }
  }
  return undefined;
}
