import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { CODEDEN_VERSION, type SetupCheck } from "@codeden/contracts";
import { checkSetup, homePaths, readLiveRunnerLock } from "@codeden/server";
import { findRunningServer } from "./running";

const MARK: Record<SetupCheck["state"], string> = {
  ok: "ok",
  warning: "!!",
  missing: "--",
  error: "xx",
};

/** Native dependencies (§16) and what breaks without them. */
const NATIVE: Array<[label: string, module: string, purpose: string]> = [
  ["Terminals", "node-pty", "the terminal panel is"],
  ["Keychain", "@napi-rs/keyring", "saved API keys are"],
];

/** Why a native module cannot load here, or null when it loads. */
function loadError(mod: string): string | null {
  try {
    createRequire(import.meta.url)(mod);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.split(/\r?\n/)[0] ?? "error";
  }
}

/**
 * `codeden doctor`: diagnostics. Runs the same detection checks as the first-run setup
 * screen (§14): installed versions, logins and supported adapter versions, with the one
 * command that fixes each problem. Exits non-zero when CodeDen cannot run a session.
 */
export async function doctor(home: string): Promise<number> {
  const paths = homePaths(home);
  const [status, server] = await Promise.all([
    checkSetup({ home }),
    findRunningServer(paths.serverLock),
  ]);
  const runner = readLiveRunnerLock(paths.runnerLock);
  const rows: Array<[string, string, string]> = [
    ["ok", "CodeDen", CODEDEN_VERSION],
    [existsSync(home) ? "ok" : "--", "Data directory", home],
    [
      server ? "ok" : "--",
      "Server",
      server ? `running on port ${server.port} (pid ${server.pid})` : "not running",
    ],
    [
      runner ? "ok" : "--",
      "Runner",
      runner ? `running on port ${runner.port} (pid ${runner.pid})` : "not running",
    ],
  ];
  for (const [label, mod, purpose] of NATIVE) {
    const error = loadError(mod);
    rows.push([error ? "xx" : "ok", label, error ? `${purpose} unavailable: ${error}` : mod]);
  }
  for (const check of status.checks) {
    const detail = [check.version, check.message].filter(Boolean).join(" - ");
    rows.push([MARK[check.state], check.label, detail]);
  }
  for (const [mark, name, detail] of rows) console.log(`${mark}  ${name.padEnd(16)} ${detail}`);

  const fixes = status.checks.filter((c) => c.state !== "ok" && c.fix);
  if (fixes.length > 0) {
    console.log("\nTo fix:");
    for (const check of fixes) {
      const fix = check.fix as NonNullable<SetupCheck["fix"]>;
      console.log(`  ${check.label}: ${fix.command}${fix.url ? ` (${fix.url})` : ""}`);
    }
  }
  for (const warning of status.warnings) console.log(`\nWarning: ${warning.message}`);
  if (!status.ready) {
    console.log(
      "\nInstall and sign in to Claude Code or Codex: at least one agent provider is required.",
    );
  }
  const node = status.checks.find((c) => c.id === "node");
  const git = status.checks.find((c) => c.id === "git");
  return status.ready && node?.state !== "missing" && git?.state !== "missing" ? 0 : 1;
}
