import type { SetupCheck, SetupCommand, SetupToolId } from "@codeden/contracts";
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

/** Commands that sign a tool in, run in the UI's terminal (§14 step 3). */
export const LOGIN_COMMANDS = {
  claude: ["claude", "auth", "login"],
  codex: ["codex", "login"],
  gh: ["gh", "auth", "login", "--web", "--git-protocol", "https"],
} as const satisfies Record<string, readonly string[]>;

/** Days before `loginExpiresAt` at which a Claude login is flagged. */
export const LOGIN_EXPIRY_WARNING_DAYS = 3;

export const MIN_NODE_MAJOR = 24;

const LABELS: Record<SetupToolId, string> = {
  claude: "Claude Code",
  codex: "Codex",
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

const loginFix = (tool: keyof typeof LOGIN_COMMANDS): SetupCommand => ({
  kind: "login",
  command: LOGIN_COMMANDS[tool].join(" "),
});

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
  platform: NodeJS.Platform;
  nodeVersion: string;
  now: number;
  browserProbe?: Partial<BrowserProbe>;
}

export async function checkClaude({ exec, platform, now }: CheckEnv): Promise<CheckResult> {
  const check = base("claude");
  const version = await exec("claude", ["--version"], { timeoutMs: 10_000 });
  if (version.notFound || version.code !== 0) {
    return {
      ...check,
      state: "missing",
      message: "Claude Code is not installed",
      fix: installFix("claude", platform),
    };
  }
  const installed = {
    ...check,
    installed: true,
    version: parseVersion(version.stdout),
    executablePath: version.path,
  };
  const status = await exec("claude", ["auth", "status"], { timeoutMs: 10_000 });
  const auth = parseClaudeAuth(status.stdout);
  if (!auth) {
    return {
      ...installed,
      state: "warning",
      message: "Could not read the Claude login state",
      fix: loginFix("claude"),
    };
  }
  const withAuth = { ...installed, ...auth };
  if (!auth.loggedIn) {
    return {
      ...withAuth,
      state: "missing",
      message: "Not signed in to Claude",
      fix: loginFix("claude"),
    };
  }
  if (expiresWithin(auth.loginExpiresAt, LOGIN_EXPIRY_WARNING_DAYS, now)) {
    return {
      ...withAuth,
      state: "warning",
      message: "Your Claude login expires soon; sign in again",
      fix: loginFix("claude"),
    };
  }
  return { ...withAuth, state: "ok", message: "Signed in" };
}

export async function checkCodex({ exec, platform }: CheckEnv): Promise<CheckResult> {
  const check = base("codex");
  const version = await exec("codex", ["--version"], { timeoutMs: 10_000 });
  if (version.notFound || version.code !== 0) {
    return {
      ...check,
      state: "missing",
      message: "Codex is not installed",
      fix: installFix("codex", platform),
    };
  }
  const installed = {
    ...check,
    installed: true,
    version: parseVersion(version.stdout),
    executablePath: version.path,
  };
  const status = await exec("codex", ["login", "status"], { timeoutMs: 10_000 });
  const login = parseCodexLogin(status.code, `${status.stdout}\n${status.stderr}`);
  if (!login.loggedIn) {
    return {
      ...installed,
      loggedIn: false,
      state: "missing",
      message: "Not signed in to Codex",
      fix: loginFix("codex"),
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

export async function checkGh({ exec, platform }: CheckEnv): Promise<CheckResult> {
  const check = base("gh");
  const version = await exec("gh", ["--version"], { timeoutMs: 10_000 });
  if (version.notFound || version.code !== 0) {
    return {
      ...check,
      state: "missing",
      message: "GitHub CLI is not installed (optional)",
      fix: installFix("gh", platform),
    };
  }
  const installed = {
    ...check,
    installed: true,
    version: parseVersion(version.stdout),
    executablePath: version.path,
  };
  // `--json hosts` never includes the token; the text fallback is parsed for the login only.
  const json = await exec("gh", ["auth", "status", "--json", "hosts"], { timeoutMs: 10_000 });
  let auth = parseGhAuthJson(json.stdout);
  if (!auth) {
    const text = await exec("gh", ["auth", "status"], { timeoutMs: 10_000 });
    auth = parseGhAuthText(text.code, `${text.stdout}\n${text.stderr}`);
  }
  if (!auth.loggedIn) {
    return {
      ...installed,
      loggedIn: false,
      state: "missing",
      message: "Not signed in to GitHub",
      fix: loginFix("gh"),
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
  return { ...check, state: "ok", message: `Node.js ${check.version}` };
}

export const CHECKS: Record<SetupToolId, (env: CheckEnv) => Promise<CheckResult>> = {
  claude: checkClaude,
  codex: checkCodex,
  gh: checkGh,
  git: checkGit,
  browser: checkBrowser,
  node: checkNode,
};
