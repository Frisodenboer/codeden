import type { ProviderIssue, ProviderStatus } from "@codeden/contracts";
import { brokenInstallMessage, type DetectExeOptions, lookupForDetect } from "../util/detect-exe";
import { runCommand } from "../util/exec";
import { compareVersions } from "../util/version";

/** Oldest opencode whose server API matches `./types.ts` (the session/permission/event API). */
export const OPENCODE_MIN_VERSION = "1.18.0";

const INSTALL = { kind: "install", command: "npm install -g opencode-ai" } as const;

export type OpencodeDetectOptions = DetectExeOptions;

/** Strip ANSI colour codes from CLI output. */
function plain(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * The logins `opencode auth list` shows, by display name (`Z.AI Coding Plan`, `OpenCode`).
 * Only names are read; the keys stay in opencode's own auth store.
 */
export function parseOpencodeAuthList(output: string): string[] {
  const names: string[] = [];
  for (const raw of plain(output).split(/\r?\n/)) {
    // `●  Z.AI Coding Plan api` (the trailing word is the login type: api, oauth, wellknown).
    const m = /^\s*[●•*]\s+(.+?)(?:\s+(api|oauth|wellknown|env))?\s*$/u.exec(raw);
    if (m?.[1]) names.push(m[1].trim());
  }
  return names;
}

/**
 * Find a working `opencode`, check its version, then list its logins (§14). opencode can also
 * use keys from environment variables, so "no stored login" is a warning, not a hard stop.
 * Never throws.
 */
export async function detectOpencode(opts: OpencodeDetectOptions = {}): Promise<ProviderStatus> {
  const status: ProviderStatus = {
    providerId: "opencode",
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
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const lookup = await lookupForDetect("opencode", { ...opts, timeoutMs });
  const broken = lookup.broken.length > 0 ? { broken: lookup.broken } : {};
  const exe = lookup.command;
  if (!exe) {
    issues.push(
      lookup.broken.length > 0
        ? {
            code: "broken_install",
            message: brokenInstallMessage("opencode", lookup.broken),
            fix: INSTALL,
          }
        : {
            code: "not_installed",
            message: "opencode is not installed (no `opencode` on PATH).",
            fix: INSTALL,
          },
    );
    return { ...status, ...broken, issues };
  }
  const version = lookup.version;
  const supported = version !== null && compareVersions(version, OPENCODE_MIN_VERSION) >= 0;
  if (!supported) {
    issues.push({
      code: "version_unsupported",
      message: `opencode ${version ?? "(unknown version)"} is older than the tested minimum ${OPENCODE_MIN_VERSION}.`,
      fix: { kind: "upgrade", command: "npm install -g opencode-ai@latest" },
    });
  }
  const auth = await runCommand(exe, ["auth", "list"], { timeoutMs });
  let loggedIn: boolean | null = null;
  let account: string | null = null;
  if (auth.code === 0) {
    const logins = parseOpencodeAuthList(`${auth.stdout}\n${auth.stderr}`);
    loggedIn = logins.length > 0;
    account = logins.length > 0 ? logins.join(", ") : null;
    if (!loggedIn) {
      issues.push({
        code: "not_logged_in",
        message: "opencode has no stored logins. Add one (for GLM: Z.AI Coding Plan).",
        fix: { kind: "login", command: "opencode auth login" },
      });
    }
  } else {
    issues.push({ code: "detect_failed", message: "Could not read `opencode auth list`." });
  }
  return {
    ...status,
    installed: true,
    version,
    executablePath: exe.kind === "node-script" ? exe.script : exe.path,
    supported,
    loggedIn,
    authMethod: loggedIn ? "api_key" : null,
    account,
    ...broken,
    issues,
  };
}
