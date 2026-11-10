import { writesConfig } from "./git";

/**
 * Read-only rules for `git`, `gh` and `sed` (§11.2): which of their forms only read. Used by
 * the read-only allowlist; each returns why a command is refused, or undefined.
 */

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
  "ls-remote",
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
  "show-ref",
  "worktree",
  "stash",
  "check-ignore",
  "check-attr",
  "count-objects",
  "cherry",
  "whatchanged",
  "range-diff",
  "version",
]);

/** Global options that take the next word as their value (`git -C dir log`). */
const GIT_VALUED = new Set(["-C", "--git-dir", "--work-tree", "--namespace"]);
/**
 * `git -c key=value` is allowed only with a plain value: a pager, editor or other command set
 * through it could run anything.
 */
const SAFE_GIT_CONFIG = /^[a-z0-9.-]+=(false|true|cat|never|always|auto|0|1)?$/i;

/** Why `git <args>` is refused in a read-only session. `args` keep their case. */
export function gitDenial(args: string[]): string | undefined {
  let i = 0;
  for (; i < args.length && args[i]?.startsWith("-"); i += 1) {
    const option = args[i] as string;
    if (GIT_VALUED.has(option)) i += 1;
    else if (option === "-c") {
      if (!SAFE_GIT_CONFIG.test(args[i + 1] ?? "")) {
        return "git -c with this setting is not allowed in a read-only session";
      }
      i += 1;
    } else if (/^--(exec-path|config-env)/.test(option)) {
      return `git ${option} is not allowed in a read-only session`;
    }
  }
  const sub = args[i]?.toLowerCase();
  const rest = args.slice(i + 1).map((a) => a.toLowerCase());
  if (!sub || !READ_ONLY_GIT.has(sub)) return `git ${sub ?? ""} may change the repository`;
  if (
    (sub === "branch" || sub === "tag" || sub === "remote" || sub === "worktree") &&
    rest.some((a) => /^-(d|m|f|-delete|-move|-force)$/.test(a) || a === "add")
  ) {
    return `git ${sub} with these options changes the repository`;
  }
  if (sub === "config" && writesConfig(rest)) return "Only reading git config is allowed";
  if (sub === "stash" && rest[0] !== "list" && rest[0] !== "show") {
    return "Only git stash list and show are allowed in a read-only session";
  }
  return undefined;
}

/** `gh` subcommand verbs that only read. */
const READ_ONLY_GH = new Set(["view", "list", "status", "diff", "checks"]);

/** Why `gh <args>` (lower-cased) is refused in a read-only session. */
export function ghDenial(args: string[]): string | undefined {
  const positional = args.filter((a) => !a.startsWith("-"));
  if (positional[0] === "search") return undefined;
  if (positional[0] === "api") {
    const at = args.findIndex((a) => a === "-x" || a === "--method");
    const method =
      at >= 0
        ? args[at + 1]
        : (args.find((a) => a.startsWith("--method="))?.slice(9) ??
          args.find((a) => /^-x./.test(a))?.slice(2));
    // Fields (`-f`, `-F`, `--input`) make gh send a POST.
    const fields = args.some((a) => /^(-f|--field|--raw-field|--input)(=.*)?$/.test(a));
    if ((method && method !== "get") || fields) {
      return "Only GET requests with gh api are allowed in a read-only session";
    }
    return undefined;
  }
  if (!args.some((a) => READ_ONLY_GH.has(a))) {
    return "Only read-only gh commands are allowed (view, list, status, diff, checks, search, GET api)";
  }
  return undefined;
}

const ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
/** sed scripts that only print: `1,40p`, `/start/,/end/p`, `5q`, `$=`. */
const SED_PRINT = new RegExp(String.raw`^(?:${ADDRESS}(?:\s*,\s*(?:${ADDRESS}|\+\d+))?)?\s*[pq=]$`);
/** sed substitutions without the `w` (write) and `e` (execute) flags. */
const SED_SUBSTITUTE = /^s([^\w\s\\])(?:(?!\1)[^\\]|\\.)*\1(?:(?!\1)[^\\]|\\.)*\1[gip0-9]*$/i;

/** Why `sed <args>` (with their case) is refused: only printing scripts may run. */
export function sedDenial(args: string[]): string | undefined {
  if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || /^--(in-place|file)/.test(a) || a === "-f")) {
    return "sed may not edit files or read scripts in a read-only session";
  }
  const scripts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a === "-e" || a === "--expression") scripts.push(args[(i += 1)] ?? "");
    else if (a.startsWith("--expression=")) scripts.push(a.slice(13));
  }
  if (scripts.length === 0) {
    const script = args.find((a) => !a.startsWith("-"));
    if (script !== undefined) scripts.push(script);
  }
  const prints = (s: string) => SED_PRINT.test(s.trim()) || SED_SUBSTITUTE.test(s.trim());
  if (scripts.length === 0 || !scripts.every(prints)) {
    return "Only sed scripts that print (such as sed -n 1,40p) are allowed in a read-only session";
  }
  return undefined;
}
