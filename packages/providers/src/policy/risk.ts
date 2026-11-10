import type { ApprovalAction } from "@codeden/contracts";
import { binName, unwrap } from "./command-words";
import { isInWorkspace, isSecretPath, isWritable, type PathContext, resolveAgainst } from "./paths";
import { pipesDownloadIntoInterpreter } from "./remote-scripts";
import { parseShell, type ShellDialect, type SimpleCommand } from "./shell";

/**
 * Risky-action classifier for the `auto` and `full` autonomy levels (§11.2). Provider-neutral:
 * adapters translate their tool calls into `classifyCommand` / `classifyWrite` /
 * `classifyRead` / `classifyFetch` calls. A risky result is turned into an approval request;
 * everything else runs freely. Writes inside the worktree, the extra roots and the OS temp
 * directory are not risky; secrets files are, wherever they are.
 */
export type RiskAssessment =
  | { risky: false }
  | { risky: true; action: ApprovalAction; reason: string };

export interface RiskContext extends PathContext {
  /** Hosts the agent may fetch freely. When omitted, web fetches are not flagged. */
  allowedHosts?: readonly string[];
  /** The shell a command runs in, for its quoting rules. Default `auto`. */
  shell?: ShellDialect;
}

const SAFE: RiskAssessment = { risky: false };
const risky = (action: ApprovalAction, reason: string): RiskAssessment => ({
  risky: true,
  action,
  reason,
});

/** How deep `bash -c "…"` style inline scripts are followed. */
const MAX_DEPTH = 4;

/**
 * Classify a shell command (any shell: POSIX, PowerShell or cmd). Downloads piped into an
 * interpreter (`curl … | sh`, `irm … | iex`) are found on the parsed pipeline in
 * `classifyList`; here, a download run through a substitution (`iex (irm …)`,
 * `bash -c "$(curl …)"`, `bash <(curl …)`).
 */
export function classifyCommand(command: string, ctx: RiskContext): RiskAssessment {
  if (
    /\b(iex|invoke-expression)\b[^|]*\b(irm|iwr|invoke-restmethod|invoke-webrequest|downloadstring)\b/i.test(
      command,
    )
  ) {
    return risky("network", "Executes a downloaded script");
  }
  if (
    /\b(bash|sh|zsh)\s+(-c\s+)?["']?\$\(\s*(curl|wget)\b/i.test(command) ||
    /<\(\s*(curl|wget)\b/i.test(command)
  ) {
    return risky("network", "Executes a downloaded script");
  }
  return classifyList(parseShell(command, ctx.shell ?? "auto"), ctx, 0);
}

/**
 * Classify commands in order. A `cd` moves where later relative paths resolve; commands in
 * substitutions and subshells are classified too, without their `cd` leaking out.
 */
function classifyList(list: SimpleCommand[], ctx: RiskContext, depth: number): RiskAssessment {
  if (pipesDownloadIntoInterpreter(list)) {
    return risky("network", "Pipes a downloaded script straight into a shell");
  }
  let here = ctx;
  for (const cmd of list) {
    for (const nested of cmd.nested) {
      const result = classifyList(nested, here, depth);
      if (result.risky) return result;
    }
    const result = classifySimple(cmd, here, depth);
    if (result.risky) return result;
    here = afterCd(cmd, here);
  }
  return SAFE;
}

const CD = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);

/** The context after `cmd` when it changes directory (`cd dir`, `Set-Location -Path dir`). */
function afterCd(cmd: SimpleCommand, ctx: RiskContext): RiskContext {
  const { tokens } = unwrap(cmd.words);
  if (!CD.has(binName(tokens[0]))) return ctx;
  const args = tokens.slice(1);
  if (args.includes("-")) return ctx;
  const target =
    namedArg(args, ["-path", "-literalpath"]) ?? args.find((a) => !a.startsWith("-")) ?? "~";
  return { ...ctx, dir: resolveAgainst(target, ctx) };
}

/** The value after a PowerShell-style named parameter (`-Path x`), if present. */
function namedArg(args: string[], names: string[]): string | undefined {
  const i = args.findIndex((a) => names.includes(a.toLowerCase()));
  return i >= 0 ? args[i + 1] : undefined;
}

/** The script of an inline shell invocation (`bash -c "…"`, `pwsh -Command …`, `cmd /c …`). */
function inlineScript(
  bin: string,
  args: string[],
): { text: string; dialect: ShellDialect } | undefined {
  if (["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"].includes(bin)) {
    const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/i.test(a));
    const text = flag >= 0 ? args.slice(flag + 1).find((a) => !a.startsWith("-")) : undefined;
    return text ? { text, dialect: "posix" } : undefined;
  }
  if (bin === "pwsh" || bin === "powershell") {
    const flag = args.findIndex((a) => /^-(c|command)$/i.test(a));
    return flag >= 0 ? { text: args.slice(flag + 1).join(" "), dialect: "powershell" } : undefined;
  }
  if (bin === "cmd") {
    const flag = args.findIndex((a) => /^\/[ck]$/i.test(a));
    return flag >= 0 ? { text: args.slice(flag + 1).join(" "), dialect: "auto" } : undefined;
  }
  return undefined;
}

/**
 * The argument as a path, or undefined when it can't be one: inline code, multi-line text
 * or anything with shell or code punctuation (`selected={row.key`) is not a file name.
 */
function asPath(arg: string): string | undefined {
  const value = arg.replace(/^-+[a-z-]*=/i, "");
  if (!value || /[\n\r{}()<>|;=`]/.test(value)) return undefined;
  return value;
}

const DISCARD = /^(\/dev\/(null|stdout|stderr|tty)|nul|\$null)$/i;

function classifySimple(cmd: SimpleCommand, ctx: RiskContext, depth: number): RiskAssessment {
  const { tokens, elevated } = unwrap(cmd.words);
  if (elevated) return risky("other", "Runs a command with elevated privileges");
  const bin = binName(tokens[0]);
  const args = tokens.slice(1);
  const lower = args.map((a) => a.toLowerCase());

  const script = inlineScript(bin, args);
  if (script && depth < MAX_DEPTH) {
    const inner = classifyList(parseShell(script.text, script.dialect), ctx, depth + 1);
    if (inner.risky) return inner;
  }

  for (const target of cmd.writes) {
    if (DISCARD.test(target)) continue;
    const write = classifyWrite(target, ctx);
    if (write.risky) return write;
  }

  if (bin === "git") return classifyGit(lower);

  const install = classifyInstall(bin, lower);
  if (install.risky) return install;

  if (["rm", "rmdir", "del", "erase", "rd", "remove-item", "ri", "unlink", "shred"].includes(bin)) {
    const targets = args.filter((a) => !a.startsWith("-") && !/^\/[a-z]$/i.test(a));
    for (const target of targets) {
      if (target === "*" || /^[\\/]$/.test(target) || /^[a-z]:[\\/]?$/i.test(target)) {
        return risky("outside_worktree", `Deletes ${target}`);
      }
      if (!isWritable(target, ctx)) {
        return risky("outside_worktree", `Deletes ${target}, outside the worktree`);
      }
    }
  }

  const dest = copyDestination(bin, args);
  if (dest) {
    const write = classifyWrite(dest, ctx);
    if (write.risky) return write;
  }

  // Secrets: any argument naming a credentials file.
  const secret = args.find((a) => {
    const value = asPath(a);
    return value !== undefined && isSecretPath(value);
  });
  if (secret) return risky("secrets", `Accesses the secrets file ${secret}`);

  const listsEnvDrive =
    /^(get-childitem|gci|ls|dir)$/.test(bin) && lower.some((a) => a.startsWith("env:"));
  if (bin === "printenv" || listsEnvDrive) {
    return risky("secrets", "Dumps environment variables");
  }
  return SAFE;
}

const COPIES = ["cp", "mv", "copy", "move", "copy-item", "move-item", "xcopy", "robocopy"];
const WRITERS = ["tee", "set-content", "out-file", "add-content"];

/** Where a copy, move or file-writing command writes. */
function copyDestination(bin: string, args: string[]): string | undefined {
  if (!COPIES.includes(bin) && !WRITERS.includes(bin)) return undefined;
  const named = WRITERS.includes(bin)
    ? namedArg(args, ["-path", "-filepath", "-literalpath"])
    : namedArg(args, ["-destination"]);
  if (named) return named;
  const positional = args.filter((a) => !a.startsWith("-") && !/^\/[a-z]+$/i.test(a));
  return WRITERS.includes(bin) ? positional[0] : positional.at(-1);
}

function classifyGit(args: string[]): RiskAssessment {
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

const GLOBAL_FLAGS = new Set(["-g", "--global", "--location=global"]);

function classifyInstall(bin: string, args: string[]): RiskAssessment {
  const sub = args[0];
  const isInstall = (verbs: string[]) => sub !== undefined && verbs.includes(sub);
  if (
    ["npm", "pnpm", "bun", "cnpm"].includes(bin) &&
    isInstall(["i", "install", "add", "link", "update", "up", "remove", "rm", "uninstall"])
  ) {
    if (args.some((a) => GLOBAL_FLAGS.has(a)))
      return risky("other", `Installs packages globally (${bin} ${sub} -g)`);
  }
  if (bin === "yarn" && sub === "global")
    return risky("other", "Installs packages globally (yarn global)");
  if (bin === "volta" && sub === "install")
    return risky("other", "Installs a global tool (volta install)");
  if (
    (bin === "pip" || bin === "pip3" || bin === "uv" || bin === "pipx") &&
    args.includes("install")
  ) {
    if (
      bin === "pipx" ||
      args.includes("--user") ||
      args.includes("--system") ||
      args.includes("--break-system-packages")
    ) {
      return risky("other", `Installs Python packages outside the project (${bin})`);
    }
  }
  if (bin === "uv" && sub === "tool" && args[1] === "install")
    return risky("other", "Installs a global tool (uv tool install)");
  if (
    (bin === "cargo" || bin === "go" || bin === "gem" || bin === "dotnet") &&
    (sub === "install" || (bin === "dotnet" && sub === "tool" && args.includes("-g")))
  ) {
    return risky("other", `Installs a global tool (${bin} ${sub})`);
  }
  if (
    [
      "brew",
      "apt",
      "apt-get",
      "yum",
      "dnf",
      "pacman",
      "zypper",
      "apk",
      "choco",
      "winget",
      "scoop",
      "port",
      "snap",
    ].includes(bin)
  ) {
    if (args.some((a) => ["install", "upgrade", "remove", "uninstall", "-s", "add"].includes(a))) {
      return risky("other", `Changes system packages (${bin})`);
    }
  }
  if (bin === "install-module" || bin === "install-package")
    return risky("other", `Installs a system-wide module (${bin})`);
  return SAFE;
}

/**
 * Classify a file write/edit. The worktree, extra roots and OS temp are fine; secrets ask. A
 * secrets file in temp counts as outside the worktree, so Full autonomy (which only asks for
 * writes outside the worktree) still asks for it.
 */
export function classifyWrite(target: string, ctx: RiskContext): RiskAssessment {
  if (!isWritable(target, ctx))
    return risky("outside_worktree", `Writes ${target}, outside the worktree`);
  if (!isSecretPath(target)) return SAFE;
  if (!isInWorkspace(target, ctx)) {
    return risky("outside_worktree", `Writes the secrets file ${target} in the temp directory`);
  }
  return risky("secrets", `Writes the secrets file ${target}`);
}

/** Classify a file read or search. Reads anywhere are fine except credential files. */
export function classifyRead(target: string, _ctx: RiskContext): RiskAssessment {
  if (isSecretPath(target)) return risky("secrets", `Reads the secrets file ${target}`);
  return SAFE;
}

/** Classify a web fetch. Only flagged when the context has an allowlist of hosts. */
export function classifyFetch(url: string, ctx: RiskContext): RiskAssessment {
  if (!ctx.allowedHosts) return SAFE;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return risky("network", `Fetches an unparseable URL: ${url}`);
  }
  const allowed = ctx.allowedHosts.some((h) => {
    const rule = h.toLowerCase();
    return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) : host === rule;
  });
  return allowed
    ? SAFE
    : risky("network", `Fetches ${host}, which is not on the allowed host list`);
}
