import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { CODEDEN_VERSION } from "@codeden/contracts";
import { homePaths, readLiveRunnerLock } from "@codeden/server";
import { findRunningServer } from "./running";

/** First line of `<command> --version`. Runs through a shell so Windows `.cmd` shims resolve; input is fixed. */
function version(command: "claude" | "codex" | "gh" | "git"): Promise<string | undefined> {
  return new Promise((resolve) => {
    exec(`${command} --version`, { timeout: 10_000, windowsHide: true }, (error, stdout) =>
      resolve(error ? undefined : stdout.trim().split("\n")[0]),
    );
  });
}

/**
 * `codeden doctor`: quick diagnostics.
 * TODO(M1): login checks (`claude auth status`, `codex login status`, `gh auth status`) and
 * supported adapter version ranges (§14).
 */
export async function doctor(home: string): Promise<number> {
  const paths = homePaths(home);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const [claude, codex, gh, git] = await Promise.all([
    version("claude"),
    version("codex"),
    version("gh"),
    version("git"),
  ]);
  const server = await findRunningServer(paths.serverLock);
  const runner = readLiveRunnerLock(paths.runnerLock);
  const rows: Array<[string, boolean, string]> = [
    ["CodeDen", true, CODEDEN_VERSION],
    ["Node.js >= 24", nodeMajor >= 24, process.versions.node],
    ["Data directory", existsSync(home), home],
    [
      "Server",
      Boolean(server),
      server ? `running on port ${server.port} (pid ${server.pid})` : "not running",
    ],
    [
      "Runner",
      Boolean(runner),
      runner ? `running on port ${runner.port} (pid ${runner.pid})` : "not running",
    ],
    ["Claude Code", Boolean(claude), claude ?? "not found"],
    ["Codex", Boolean(codex), codex ?? "not found"],
    ["GitHub CLI", Boolean(gh), gh ?? "not found (optional)"],
    ["git", Boolean(git), git ?? "not found"],
  ];
  for (const [name, ok, detail] of rows) {
    console.log(`${ok ? "ok" : "--"}  ${name.padEnd(16)} ${detail}`);
  }
  const hasProvider = Boolean(claude || codex);
  if (!hasProvider) {
    console.log("\nInstall Claude Code or Codex: at least one agent provider is required.");
  }
  return nodeMajor >= 24 && git && hasProvider ? 0 : 1;
}
