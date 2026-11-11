import type { SetupCheck, SetupCommand, SetupToolId } from "@codeden/contracts";
import { isElectronRuntime, parseOpencodeAuthList } from "@codeden/providers";
import type { Exec } from "../exec";
import { type BrowserProbe, detectBrowser } from "./browsers";
import {
  expiresWithin,
  parseClaudeAuth,
  parseCodexLogin,
  parseGhAuthJson,
  parseGhAuthText,
  parseVersion,
} from "./parse";
import { LOGIN_COMMANDS, type Locate, loginFix, lookupTool, runDetail } from "./tool-lookup";

export { LOGIN_COMMANDS };

/** Days before `loginExpiresAt` at which a Claude login is flagged. */
export const LOGIN_EXPIRY_WARNING_DAYS = 3;

export const MIN_NODE_MAJOR = 24;

const LABELS: Record<SetupToolId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  gh: "GitHub CLI",
  git: "git",
  browser: "Browser",
  node: "Node.js",
};

function installFix(id: SetupToolId, platform: NodeJS.Platform): SetupCommand {
  switch (id) {
    case "claude":
      return { kind: "install", command: "npm install -g @anthropic-ai/claude-code" };
    case "codex":
      return { kind: "install", command: "npm install -g @openai/codex" };
    case "opencode":
      return { kind: "install", command: "npm install -g opencode-ai" };
    case "gh":
      return {
        kind: "install",
        command:
          platform === "win32"
            ? "winget install --id GitHub.cli"
            : platform === "darwin"
              ? "brew install gh"
              : "See https://github.com/cli/cli#installation",
        url: "https://cli.github.com",
      };
    case "git":
      return {
        kind: "install",
        command:
          platform === "win32"
            ? "winget install --id Git.Git"
            : platform === "darwin"
              ? "xcode-select --install"
              : "Install git with your package manager",
        url: "https://git-scm.com/downloads",
      };
    case "browser":
      return {
        kind: "install",
        command: "Install Microsoft Edge or Google Chrome",
        url: "https://www.google.com/chrome/",
      };
    case "node":
      return {
        kind: "upgrade",
        command: `Install Node.js ${MIN_NODE_MAJOR} or newer`,
        url: "https://nodejs.org",
      };
  }
}

function base(id: SetupToolId): Omit<SetupCheck, "state" | "message" | "durationMs"> {
  return {
    id,
    label: LABELS[id],
    installed: false,
    version: null,
    executablePath: null,
    loggedIn: null,
    authMethod: null,
    account: null,
    loginExpiresAt: null,
    fix: null,
  };
}

type CheckResult = Omit<SetupCheck, "durationMs">;

export interface CheckEnv {
  exec: Exec;
  /** Finds a working copy of claude, codex and gh (PATH, then known install locations). */
  locate: Locate;
  /** The shell of the setup terminal, for quoting sign-in commands. */
  shell: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  now: number;
  browserProbe?: Partial<BrowserProbe>;
}

export async function checkClaude({
  exec,
  locate,
  shell,
  platform,
  now,
}: CheckEnv): Promise<CheckResult> {
  const tool = await lookupTool(locate, "claude", base("claude"), {
    message: "Claude Code is not installed",
    fix: installFix("claude", platform),
  });
  if (!tool.found) return tool.result;
  const installed = {
    ...base("claude"),
    ...tool.extra,
    installed: true,
    version: tool.version,
    executablePath: tool.path,
  };
  const login = loginFix("claude", shell, tool.path);
  const status = await exec(tool.path, ["auth", "status"], { timeoutMs: 10_000 });
  const auth = parseClaudeAuth(status.stdout);
  if (!auth) {
    return {
      ...installed,
      state: "warning",
      message: "Could not read the Claude login state",
      detail: runDetail("claude auth status", status),
      fix: login,
    };
  }
  const withAuth = { ...installed, ...auth };
  if (!auth.loggedIn) {
    return { ...withAuth, state: "missing", message: "Not signed in to Claude", fix: login };
  }
  if (expiresWithin(auth.loginExpiresAt, LOGIN_EXPIRY_WARNING_DAYS, now)) {
    return {
      ...withAuth,
      state: "warning",
      message: "Your Claude login expires soon; sign in again",
      fix: login,
    };
  }
  return { ...withAuth, state: "ok", message: "Signed in" };
}

export async function checkCodex({
  exec,
  locate,
  shell,
  platform,
}: CheckEnv): Promise<CheckResult> {
  const tool = await lookupTool(locate, "codex", base("codex"), {
    message: "Codex is not installed",
    fix: installFix("codex", platform),
  });
  if (!tool.found) return tool.result;
  const installed = {
    ...base("codex"),
    ...tool.extra,
    installed: true,
    version: tool.version,
    executablePath: tool.path,
  };
  const status = await exec(tool.path, ["login", "status"], { timeoutMs: 10_000 });
  const login = parseCodexLogin(
    status.code,
    `${status.stdout}
${status.stderr}`,
  );
  if (!login.loggedIn) {
    return {
      ...installed,
      loggedIn: false,
      state: "missing",
      message: "Not signed in to Codex",
      ...(status.code !== 0 && !/not logged in/i.test(`${status.stdout}${status.stderr}`)
        ? { detail: runDetail("codex login status", status) }
        : {}),
      fix: loginFix("codex", shell, tool.path),
    };
  }
  return {
    ...installed,
    loggedIn: true,
    authMethod: login.authMethod,
    state: "ok",
    message: "Signed in",
  };
}

/**
 * opencode: installed, and at least one stored login (`opencode auth list`, names only; the keys
 * stay in opencode's own store). opencode also reads keys from environment variables, so no
 * stored login is a warning rather than a hard stop.
 */
export async function checkOpencode({
  exec,
  locate,
  shell,
  platform,
}: CheckEnv): Promise<CheckResult> {
  const tool = await lookupTool(locate, "opencode", base("opencode"), {
    message: "opencode is not installed (optional, for GLM and other models)",
    fix: installFix("opencode", platform),
  });
  if (!tool.found) return tool.result;
  const installed = {
    ...base("opencode"),
    ...tool.extra,
    installed: true,
    version: tool.version,
    executablePath: tool.path,
  };
  const list = await exec(tool.path, ["auth", "list"], { timeoutMs: 15_000 });
  if (list.code !== 0) {
    return {
      ...installed,
      loggedIn: null,
      state: "warning",
      message: "Could not read opencode's logins",
      detail: runDetail("opencode auth list", list),
    };
  }
  const logins = parseOpencodeAuthList(`${list.stdout}\n${list.stderr}`);
  if (logins.length === 0) {
    return {
      ...installed,
      loggedIn: false,
      state: "warning",
      message: "opencode has no stored logins (add one, e.g. Z.AI Coding Plan for GLM)",
      fix: loginFix("opencode", shell, tool.path),
    };
  }
  return {
    ...installed,
    loggedIn: true,
    authMethod: "api_key",
    account: logins.join(", "),
    state: "ok",
    message: `Signed in (${logins.join(", ")})`,
  };
}

export async function checkGh({ exec, locate, shell, platform }: CheckEnv): Promise<CheckResult> {
  const tool = await lookupTool(locate, "gh", base("gh"), {
    message: "GitHub CLI is not installed (optional)",
    fix: installFix("gh", platform),
  });
  if (!tool.found) return tool.result;
  const installed = {
    ...base("gh"),
    ...tool.extra,
    installed: true,
    version: tool.version,
    executablePath: tool.path,
  };
  // `--json hosts` never includes the token; the text fallback is parsed for the login only.
  const json = await exec(tool.path, ["auth", "status", "--json", "hosts"], { timeoutMs: 10_000 });
  let auth = parseGhAuthJson(json.stdout);
  if (!auth) {
    const text = await exec(tool.path, ["auth", "status"], { timeoutMs: 10_000 });
    auth = parseGhAuthText(
      text.code,
      `${text.stdout}
${text.stderr}`,
    );
  }
  if (!auth.loggedIn) {
    return {
      ...installed,
      loggedIn: false,
      state: "missing",
      message: "Not signed in to GitHub",
      fix: loginFix("gh", shell, tool.path),
    };
  }
  return { ...installed, loggedIn: true, account: auth.account, state: "ok", message: "Signed in" };
}

export async function checkGit({ exec, platform }: CheckEnv): Promise<CheckResult> {
  const check = base("git");
  const version = await exec("git", ["--version"], { timeoutMs: 10_000 });
  if (version.notFound || version.code !== 0) {
    return {
      ...check,
      state: "missing",
      message: "git is not installed",
      fix: installFix("git", platform),
    };
  }
  const [name, email] = await Promise.all([
    exec("git", ["config", "--get", "user.name"], { timeoutMs: 5_000 }),
    exec("git", ["config", "--get", "user.email"], { timeoutMs: 5_000 }),
  ]);
  const user = name.stdout.trim();
  const mail = email.stdout.trim();
  const installed = {
    ...check,
    installed: true,
    version: parseVersion(version.stdout),
    executablePath: version.path,
    account: user && mail ? `${user} <${mail}>` : user || mail || null,
  };
  if (!user || !mail) {
    return {
      ...installed,
      state: "warning",
      message: "git user.name and user.email are not set",
      fix: {
        kind: "configure",
        command:
          'git config --global user.name "Your Name" && git config --global user.email you@example.com',
      },
    };
  }
  return { ...installed, state: "ok", message: "Identity configured" };
}

export async function checkBrowser({
  exec,
  platform,
  browserProbe,
}: CheckEnv): Promise<CheckResult> {
  const check = base("browser");
  const found = await detectBrowser({
    platform,
    ...browserProbe,
    exec: browserProbe?.exec ?? exec,
  });
  if (!found) {
    return {
      ...check,
      state: "warning",
      message: "No Edge or Chrome found (needed for the browser panel)",
      fix: installFix("browser", platform),
    };
  }
  return {
    ...check,
    installed: true,
    executablePath: found.path,
    state: "ok",
    message: found.name,
  };
}

export async function checkNode({ nodeVersion, platform }: CheckEnv): Promise<CheckResult> {
  const check = {
    ...base("node"),
    installed: true,
    version: nodeVersion.replace(/^v/, ""),
    executablePath: process.execPath,
  };
  const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0);
  if (major < MIN_NODE_MAJOR) {
    return {
      ...check,
      state: "missing",
      message: `Node.js ${MIN_NODE_MAJOR}+ is required`,
      fix: installFix("node", platform),
    };
  }
  // The desktop app runs on the Node.js built into it; no system Node.js is needed (§17).
  if (isElectronRuntime()) {
    return { ...check, state: "ok", message: `Node.js ${check.version} (built into the app)` };
  }
  return { ...check, state: "ok", message: `Node.js ${check.version}` };
}

export const CHECKS: Record<SetupToolId, (env: CheckEnv) => Promise<CheckResult>> = {
  claude: checkClaude,
  codex: checkCodex,
  opencode: checkOpencode,
  gh: checkGh,
  git: checkGit,
  browser: checkBrowser,
  node: checkNode,
};
