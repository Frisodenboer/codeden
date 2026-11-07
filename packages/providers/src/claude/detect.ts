import type { ProviderIssue, ProviderStatus } from "@codeden/contracts";
import { type ResolvedCommand, resolveExecutable, runCommand } from "../util/exec";
import { compareVersions, parseVersion } from "../util/version";

/** Oldest Claude Code version the adapter is tested against (pinned SDK 0.3.318). */
export const CLAUDE_MIN_VERSION = "2.1.250";
const LOGIN_EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export interface ClaudeDetectOptions {
  executable?: ResolvedCommand;
  timeoutMs?: number;
}

/** `claude --version` + `claude auth status` (§14). Never throws. */
export async function detectClaude(opts: ClaudeDetectOptions = {}): Promise<ProviderStatus> {
  const checkedAt = new Date().toISOString();
  const status: ProviderStatus = {
    providerId: "claude",
    installed: false,
    version: null,
    executablePath: null,
    loggedIn: null,
    authMethod: null,
    account: null,
    loginExpiresAt: null,
    supported: false,
    issues: [],
    checkedAt,
  };
  const issues: ProviderIssue[] = [];
  const exe = opts.executable ?? resolveExecutable("claude");
  if (!exe) {
    issues.push({
      code: "not_installed",
      message: "Claude Code is not installed (no `claude` on PATH).",
      fix: { kind: "install", command: "npm install -g @anthropic-ai/claude-code" },
    });
    return { ...status, issues };
  }
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const versionRun = await runCommand(exe, ["--version"], { timeoutMs });
  const version = parseVersion(versionRun.stdout);
  if (versionRun.error || !version) {
    issues.push({
      code: "detect_failed",
      message: `Could not run \`claude --version\`: ${versionRun.error?.message ?? (versionRun.timedOut ? "timed out" : versionRun.stderr.trim() || "no version in output")}`,
    });
    return { ...status, executablePath: exe.path, issues };
  }
  const supported = compareVersions(version, CLAUDE_MIN_VERSION) >= 0;
  if (!supported) {
    issues.push({
      code: "version_unsupported",
      message: `Claude Code ${version} is older than the tested minimum ${CLAUDE_MIN_VERSION}.`,
      fix: { kind: "upgrade", command: "claude update" },
    });
  }
  const auth = parseClaudeAuthStatus(
    (await runCommand(exe, ["auth", "status"], { timeoutMs })).stdout,
  );
  if (auth.loggedIn === false) {
    issues.push({
      code: "not_logged_in",
      message: "Claude Code is not logged in.",
      fix: { kind: "login", command: "claude auth login" },
    });
  } else if (auth.loggedIn === null) {
    issues.push({ code: "detect_failed", message: "Could not read `claude auth status`." });
  } else if (
    auth.loginExpiresAt &&
    Date.parse(auth.loginExpiresAt) - Date.now() < LOGIN_EXPIRY_WARNING_MS
  ) {
    issues.push({
      code: "login_expiring",
      message: `Claude Code login expires at ${auth.loginExpiresAt}.`,
      fix: { kind: "login", command: "claude auth login" },
    });
  }
  return {
    ...status,
    installed: true,
    version,
    executablePath: exe.kind === "node-script" ? exe.script : exe.path,
    supported,
    ...auth,
    issues,
  };
}

/** Parse `claude auth status` JSON (`loggedIn`, `authMethod`, `email`, `loginExpiresAt`). */
export function parseClaudeAuthStatus(
  stdout: string,
): Pick<ProviderStatus, "loggedIn" | "authMethod" | "account" | "loginExpiresAt"> {
  const unknown = { loggedIn: null, authMethod: null, account: null, loginExpiresAt: null };
  const start = stdout.indexOf("{");
  if (start < 0) return unknown;
  try {
    const json = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
    const expires = typeof json.loginExpiresAt === "string" ? json.loginExpiresAt : null;
    return {
      loggedIn: typeof json.loggedIn === "boolean" ? json.loggedIn : null,
      authMethod: typeof json.authMethod === "string" ? json.authMethod : null,
      account: typeof json.email === "string" ? json.email : null,
      loginExpiresAt:
        expires && !Number.isNaN(Date.parse(expires)) ? new Date(expires).toISOString() : null,
    };
  } catch {
    return unknown;
  }
}
