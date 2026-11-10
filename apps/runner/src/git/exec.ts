import { spawn } from "node:child_process";
import { CommandError } from "../errors";
import { childEnv } from "../process/env";
import { killTree } from "../process/tree";

export interface GitOptions {
  /** Extra environment (e.g. `GIT_INDEX_FILE`). */
  env?: Record<string, string>;
  /** Written to stdin. */
  input?: string | Buffer;
  /** Default 60s. */
  timeoutMs?: number;
  /** Exit codes that are not errors (e.g. `[0, 1]` for `diff --quiet`). */
  okCodes?: number[];
}

export interface GitResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

/**
 * Run `git` non-interactively: no terminal prompts, no credential manager windows, no pager,
 * no editor, stable output. Throws `CommandError("git_failed")` with stderr for unexpected
 * exit codes.
 */
export function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      windowsHide: true,
      env: childEnv({
        GIT_TERMINAL_PROMPT: "0",
        // Git Credential Manager: fail instead of opening a sign-in window (a background fetch).
        GCM_INTERACTIVE: "never",
        GIT_PAGER: "cat",
        GIT_EDITOR: "true",
        LC_ALL: "C",
        ...opts.env,
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) void killTree(child.pid, 200);
    }, opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.stdin.on("error", () => undefined);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new CommandError("git_unavailable", `Could not run git: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(err).toString("utf8").trim();
      const exit = code ?? -1;
      if (timedOut) {
        reject(new CommandError("git_timeout", `git ${args[0]} timed out`));
      } else if (!(opts.okCodes ?? [0]).includes(exit)) {
        reject(
          new CommandError(
            "git_failed",
            `git ${args[0]} failed (${exit}): ${stderr || "no output"}`,
          ),
        );
      } else {
        resolve({ stdout: Buffer.concat(out), stderr, code: exit });
      }
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** `git ...` and return trimmed stdout as text. */
export async function gitText(cwd: string, args: string[], opts?: GitOptions): Promise<string> {
  return (await git(cwd, args, opts)).stdout.toString("utf8").trim();
}

/** `git ...` returning true on exit 0, false on any failure. */
export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/** True when `cwd` is inside a git work tree. */
export function isWorkTree(cwd: string): Promise<boolean> {
  return gitOk(cwd, ["rev-parse", "--is-inside-work-tree"]);
}

/** Split NUL-separated output, dropping the trailing empty field. */
export function splitNul(buf: Buffer | string): string[] {
  const parts = buf.toString().split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}
