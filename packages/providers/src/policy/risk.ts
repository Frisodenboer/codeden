import type { ApprovalAction } from "@codeden/contracts";
import { isInWorkspace, isSecretPath, type PathContext } from "./paths";

/**
 * Risky-action classifier for the `auto` autonomy level (§11.2). Provider-neutral: adapters
 * translate their tool calls into `classifyCommand` / `classifyWrite` / `classifyRead` /
 * `classifyFetch` calls. A risky result is turned into an approval request; everything else
 * runs freely.
 */
export type RiskAssessment =
  | { risky: false }
  | { risky: true; action: ApprovalAction; reason: string };

export interface RiskContext extends PathContext {
  /** Hosts the agent may fetch freely. When omitted, web fetches are not flagged. */
  allowedHosts?: readonly string[];
}

const SAFE: RiskAssessment = { risky: false };
const risky = (action: ApprovalAction, reason: string): RiskAssessment => ({
  risky: true,
  action,
  reason,
});

/** Split a shell command line into simple commands (on `;`, `&&`, `||`, `|`, newlines). */
export function splitCommands(command: string): string[] {
  return command
    .split(/\r?\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Tokenize one simple command, honouring single and double quotes. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const m of command.matchAll(re)) tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  return tokens;
}

/** Strip wrappers that don't change what runs (`sudo`, `env X=1`, `command`, `exec`). */
function unwrap(tokens: string[]): { tokens: string[]; elevated: boolean } {
  let elevated = false;
  let rest = tokens;
  for (;;) {
    const head = rest[0]?.toLowerCase();
    if (head === "sudo" || head === "doas" || head === "runas" || head === "gsudo") {
      elevated = true;
      rest = rest.slice(1).filter((t, i) => !(i === 0 && t.startsWith("-")));
    } else if (head === "env" || head === "command" || head === "exec" || head === "nohup") {
      rest = rest.slice(1);
    } else if (head && /^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      rest = rest.slice(1);
    } else break;
  }
  return { tokens: rest, elevated };
}

const binName = (token: string | undefined): string =>
  (token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "") ?? "";

const DOWNLOADERS = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b|downloadstring/i;
const SHELLS =
  /^\s*(sudo\s+)?(sh|bash|zsh|fish|dash|ksh|iex|invoke-expression|python3?|node|pwsh|powershell|perl|ruby)(\s|$)/i;

/** Classify a shell command (any shell: POSIX, PowerShell or cmd). */
export function classifyCommand(command: string, ctx: RiskContext): RiskAssessment {
  // Remote script piped into an interpreter: `curl ... | sh`, `irm ... | iex`, `iex (irm ...)`.
  const pipeline = command.split(/\|(?!\|)/);
  for (let i = 1; i < pipeline.length; i += 1) {
    if (DOWNLOADERS.test(pipeline[i - 1] ?? "") && SHELLS.test(pipeline[i] ?? "")) {
      return risky("network", "Pipes a downloaded script straight into a shell");
    }
  }
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

  for (const simple of splitCommands(command)) {
    const result = classifySimple(simple, ctx);
    if (result.risky) return result;
  }
  return SAFE;
}

function classifySimple(simple: string, ctx: RiskContext): RiskAssessment {
  const { tokens, elevated } = unwrap(tokenize(simple));
  if (elevated) return risky("other", "Runs a command with elevated privileges");
  const bin = binName(tokens[0]);
  const args = tokens.slice(1);
  const lower = args.map((a) => a.toLowerCase());

  if (bin === "git") return classifyGit(lower);

  const install = classifyInstall(bin, lower);
  if (install.risky) return install;

  if (["rm", "rmdir", "del", "erase", "rd", "remove-item", "ri", "unlink", "shred"].includes(bin)) {
    const targets = args.filter((a) => !a.startsWith("-") && !/^\/[a-z]$/i.test(a));
    for (const target of targets) {
      if (target === "*" || /^[\\/]$/.test(target) || /^[a-z]:[\\/]?$/i.test(target)) {
        return risky("outside_worktree", `Deletes ${target}`);
      }
      if (!isInWorkspace(target, ctx)) {
        return risky("outside_worktree", `Deletes ${target}, outside the worktree`);
      }
    }
  }

  // Redirects or copy/move destinations outside the worktree.
  for (const m of simple.matchAll(/(?:^|[^0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const target = m[1] ?? "";
    if (/^(\/dev\/null|nul|\$null)$/i.test(target) || /^&\d$/.test(target)) continue;
    if (!isInWorkspace(target, ctx))
      return risky("outside_worktree", `Writes ${target}, outside the worktree`);
    if (isSecretPath(target)) return risky("secrets", `Writes the secrets file ${target}`);
  }
  if (
    [
      "cp",
      "mv",
      "copy",
      "move",
      "copy-item",
      "move-item",
      "xcopy",
      "robocopy",
      "tee",
      "set-content",
      "out-file",
      "add-content",
    ].includes(bin)
  ) {
    const positional = args.filter((a) => !a.startsWith("-") && !/^\/[a-z]+$/i.test(a));
    const dest = ["tee", "set-content", "out-file", "add-content"].includes(bin)
      ? positional[0]
      : positional.at(-1);
    if (dest && !isInWorkspace(dest, ctx))
      return risky("outside_worktree", `Writes ${dest}, outside the worktree`);
  }

  // Secrets: any argument naming a credentials file.
  const secret = args.find((a) => isSecretPath(a.replace(/^-+[a-z-]*=/i, "")));
  if (secret) return risky("secrets", `Accesses the secrets file ${secret}`);

  const listsEnvDrive =
    /^(get-childitem|gci|ls|dir)$/.test(bin) && lower.some((a) => a.startsWith("env:"));
  if (bin === "printenv" || listsEnvDrive) {
    return risky("secrets", "Dumps environment variables");
  }
  return SAFE;
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

/** Classify a file write/edit. */
export function classifyWrite(target: string, ctx: RiskContext): RiskAssessment {
  if (!isInWorkspace(target, ctx))
    return risky("outside_worktree", `Writes ${target}, outside the worktree`);
  if (isSecretPath(target)) return risky("secrets", `Writes the secrets file ${target}`);
  return SAFE;
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
