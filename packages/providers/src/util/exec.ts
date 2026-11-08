import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * How to launch a resolved executable. On Windows, npm-style `.cmd` shims cannot be spawned
 * without a shell (Node rejects them with EINVAL), so we unwrap them to `node <script>` when
 * possible and fall back to `cmd.exe /d /s /c` otherwise.
 */
export type ResolvedCommand =
  | { kind: "native"; path: string }
  | { kind: "node-script"; path: string; script: string }
  | { kind: "shell-script"; path: string };

export interface ResolveOptions {
  /** Defaults to `process.env.PATH`. */
  pathEnv?: string;
  /** Defaults to `process.env.PATHEXT` (Windows only). */
  pathExt?: string;
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Find `name` on PATH and decide how to launch it. Returns `undefined` when not found.
 * An absolute or relative path containing a separator is resolved directly.
 */
export function resolveExecutable(
  name: string,
  opts: ResolveOptions = {},
): ResolvedCommand | undefined {
  const platform = opts.platform ?? process.platform;
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const exts = win
    ? (opts.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter(Boolean)
        .map((e) => e.toLowerCase())
    : [""];
  const hasExt = win && exts.includes(p.extname(name).toLowerCase());
  const candidatesFor = (base: string): string[] =>
    win ? (hasExt ? [base] : exts.map((e) => base + e)) : [base];

  const dirs = name.includes("/") || name.includes("\\") ? [""] : splitPath(opts, win);
  for (const dir of dirs) {
    for (const candidate of candidatesFor(dir ? p.join(dir, name) : name)) {
      if (isFile(candidate)) return classify(candidate, win);
    }
  }
  return undefined;
}

function splitPath(opts: ResolveOptions, win: boolean): string[] {
  const raw = opts.pathEnv ?? process.env.PATH ?? process.env.Path ?? "";
  return raw
    .split(win ? ";" : ":")
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function classify(file: string, win: boolean): ResolvedCommand {
  const ext = path.extname(file).toLowerCase();
  if (win && (ext === ".cmd" || ext === ".bat")) {
    const script = scriptFromCmdShim(file);
    return script
      ? { kind: "node-script", path: file, script }
      : { kind: "shell-script", path: file };
  }
  if ([".js", ".mjs", ".cjs"].includes(ext))
    return { kind: "node-script", path: file, script: file };
  return { kind: "native", path: file };
}

/**
 * Extract the JavaScript entry point from an npm/pnpm/yarn `.cmd` shim, e.g.
 * `"%dp0%\node_modules\@openai\codex\bin\codex.js" %*`. Returns `undefined` if the shim does
 * not point at a script that exists.
 */
export function scriptFromCmdShim(shimPath: string, content?: string): string | undefined {
  let text = content;
  if (text === undefined) {
    try {
      text = readFileSync(shimPath, "utf8");
    } catch {
      return undefined;
    }
  }
  const re = /"%~?dp0%?\\?([^"%]+?\.[cm]?js)"/gi;
  let last: string | undefined;
  for (const match of text.matchAll(re)) last = match[1];
  if (!last) return undefined;
  const script = path.win32.resolve(path.win32.dirname(shimPath), last);
  if (content === undefined && !existsSync(script)) return undefined;
  return script;
}

/** True inside the desktop app, where `process.execPath` is the Electron binary (§17). */
export function isElectronRuntime(versions: NodeJS.ProcessVersions = process.versions): boolean {
  return typeof (versions as { electron?: unknown }).electron === "string";
}

/**
 * Environment for running one of CodeDen's own scripts (the runner, npm, Playwright's CLI)
 * with `process.execPath`. In the desktop app that is the Electron binary, which only acts
 * as Node.js with `ELECTRON_RUN_AS_NODE=1`; elsewhere the environment is returned unchanged.
 */
export function ownNodeEnv(
  env: NodeJS.ProcessEnv = process.env,
  versions: NodeJS.ProcessVersions = process.versions,
): NodeJS.ProcessEnv {
  return isElectronRuntime(versions) ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env;
}

let systemNode: string | null | undefined;

/**
 * The Node.js that runs `node-script` commands (npm-style shims of the user's own tools, such
 * as a globally installed Codex on Windows). Normally the Node running CodeDen. In the desktop
 * app the user's `node` from PATH is preferred, so their tools run exactly as in a terminal
 * and `ELECTRON_RUN_AS_NODE` never leaks into agent processes; without one, the Electron
 * binary runs them as Node.js.
 */
export function scriptRuntime(): { path: string; electron: boolean } {
  if (!isElectronRuntime()) return { path: process.execPath, electron: false };
  if (systemNode === undefined) {
    const found = resolveExecutable("node");
    systemNode = found?.kind === "native" ? found.path : null;
  }
  return systemNode
    ? { path: systemNode, electron: false }
    : { path: process.execPath, electron: true };
}

/** The `[command, args]` to pass to `spawn` for a resolved executable (never needs `shell`). */
export function spawnArgs(cmd: ResolvedCommand, args: readonly string[]): [string, string[]] {
  switch (cmd.kind) {
    case "native":
      return [cmd.path, [...args]];
    case "node-script":
      return [scriptRuntime().path, [cmd.script, ...args]];
    case "shell-script":
      return [
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", `"${[cmd.path, ...args].map(quoteCmdArg).join(" ")}"`],
      ];
  }
}

/** Quote one argument for `cmd.exe /s /c "..."`. */
export function quoteCmdArg(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^%!()]/.test(arg)) return arg;
  return `"${arg.replace(/(["^%!])/g, "^$1")}"`;
}

/** Spawn a resolved executable. Uses `windowsVerbatimArguments` for the cmd.exe fallback. */
export function spawnResolved(
  cmd: ResolvedCommand,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const [file, argv] = spawnArgs(cmd, args);
  const asNode = cmd.kind === "node-script" && scriptRuntime().electron;
  return spawn(file, argv, {
    windowsHide: true,
    ...options,
    ...(asNode ? { env: ownNodeEnv(options.env ?? process.env) } : {}),
    ...(cmd.kind === "shell-script" ? { windowsVerbatimArguments: true } : {}),
  });
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be started. */
  error?: Error;
}

/** Run a command to completion with a timeout. Never throws. */
export function runCommand(
  cmd: ResolvedCommand,
  args: readonly string[],
  opts: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ChildProcess;
    try {
      child = spawnResolved(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: null, stdout, stderr, timedOut, error: error as Error });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      done({ code: null, stdout, stderr, timedOut });
    }, opts.timeoutMs ?? 15_000);
    child.stdout?.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr?.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", (error) => done({ code: null, stdout, stderr, timedOut, error }));
    child.on("close", (code) => done({ code, stdout, stderr, timedOut }));
  });
}

/** Kill a process and its children. On Windows `taskkill /T` is the only reliable way. */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      }).on("error", () => child.kill());
      return;
    } catch {
      // fall through
    }
  }
  child.kill("SIGTERM");
}
