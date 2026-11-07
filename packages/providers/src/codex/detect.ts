import type { ProviderIssue, ProviderStatus } from "@codeden/contracts";
import { type ResolvedCommand, resolveExecutable, runCommand } from "../util/exec";
import { compareVersions, parseVersion } from "../util/version";

/** Oldest Codex version whose app-server protocol matches the generated types. */
export const CODEX_MIN_VERSION = "0.160.0";

export interface CodexDetectOptions {
  executable?: ResolvedCommand;
  timeoutMs?: number;
}

/** `codex --version` + `codex login status` (§14). Never throws. */
export async function detectCodex(opts: CodexDetectOptions = {}): Promise<ProviderStatus> {
  const status: ProviderStatus = {
    providerId: "codex",
    installed: false,
    version: null,
    executablePath: null,
    loggedIn: null,
    authMethod: null,
    account: null,
    loginExpiresAt: null,
    supported: false,
    issues: [],
    checkedAt: new Date().toISOString(),
  };
  const issues: ProviderIssue[] = [];
  const exe = opts.executable ?? resolveExecutable("codex");
  if (!exe) {
    issues.push({
      code: "not_installed",
      message: "Codex is not installed (no `codex` on PATH).",
      fix: { kind: "install", command: "npm install -g @openai/codex" },
    });
    return { ...status, issues };
  }
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const versionRun = await runCommand(exe, ["--version"], { timeoutMs });
  const version = parseVersion(versionRun.stdout);
  if (versionRun.error || !version) {
    issues.push({
      code: "detect_failed",
      message: `Could not run \`codex --version\`: ${versionRun.error?.message ?? (versionRun.timedOut ? "timed out" : versionRun.stderr.trim() || "no version in output")}`,
    });
    return { ...status, executablePath: exe.path, issues };
  }
  const supported = compareVersions(version, CODEX_MIN_VERSION) >= 0;
  if (!supported) {
    issues.push({
      code: "version_unsupported",
      message: `Codex ${version} is older than the tested minimum ${CODEX_MIN_VERSION}.`,
      fix: { kind: "upgrade", command: "npm install -g @openai/codex@latest" },
    });
  }
  const login = await runCommand(exe, ["login", "status"], { timeoutMs });
  const auth = parseCodexLoginStatus(`${login.stdout}\n${login.stderr}`, login.code);
  if (auth.loggedIn === false) {
    issues.push({
      code: "not_logged_in",
      message: "Codex is not logged in.",
      fix: { kind: "login", command: "codex login" },
    });
  } else if (auth.loggedIn === null) {
    issues.push({ code: "detect_failed", message: "Could not read `codex login status`." });
  }
  return {
    ...status,
    installed: true,
    version,
    executablePath: exe.kind === "node-script" ? exe.script : exe.path,
    supported,
    loggedIn: auth.loggedIn,
    authMethod: auth.authMethod,
    issues,
  };
}

/** Parse `codex login status` text, e.g. `Logged in using ChatGPT` / `Not logged in`. */
export function parseCodexLoginStatus(
  output: string,
  exitCode: number | null,
): { loggedIn: boolean | null; authMethod: string | null } {
  if (/not logged in/i.test(output)) return { loggedIn: false, authMethod: null };
  const m = /logged in(?: using| with)?\s+(?:an?\s+)?([^\r\n]+)/i.exec(output);
  if (m) {
    const raw = (m[1] ?? "").trim().toLowerCase();
    const authMethod = raw.includes("chatgpt")
      ? "chatgpt"
      : raw.includes("api key")
        ? "api_key"
        : raw || null;
    return { loggedIn: true, authMethod };
  }
  if (exitCode !== null && exitCode !== 0 && output.trim())
    return { loggedIn: false, authMethod: null };
  return { loggedIn: null, authMethod: null };
}
