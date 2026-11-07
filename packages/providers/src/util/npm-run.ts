import { killTree, type ResolvedCommand, spawnResolved } from "./exec";

export interface RunNpmOptions {
  cwd: string;
  timeoutMs: number;
  /** Each non-empty output line (trimmed, at most 300 characters), for progress UIs. */
  onLine: (line: string) => void;
  /** Extra environment on top of `process.env`. */
  env?: Record<string, string>;
}

/**
 * Run npm with `args` (on-demand installs: Claude Code support in `<home>/deps`, CodeDen
 * versions in `<home>/app`), streaming its output lines. Rejects with npm's own error summary
 * on a non-zero exit, and kills the process tree on timeout.
 */
export function runNpm(npm: ResolvedCommand, args: string[], opts: RunNpmOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnResolved(npm, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        npm_config_update_notifier: "false",
        npm_config_progress: "false",
        ...opts.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const onData = (chunk: string) => {
      output = (output + chunk).slice(-20_000);
      for (const line of chunk.split(/\r?\n/)) {
        const text = line.trim();
        if (text) opts.onLine(text.slice(0, 300));
      }
    };
    child.stdout?.setEncoding("utf8").on("data", onData);
    child.stderr?.setEncoding("utf8").on("data", onData);
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`npm timed out after ${Math.round(opts.timeoutMs / 1000)}s`));
    }, opts.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start npm: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const reason = npmFailure(output);
      reject(new Error(`npm install exited with code ${code}${reason ? `: ${reason}` : ""}`));
    });
  });
}

/**
 * The useful part of npm's error output: its error code and the first descriptive line
 * (`npm error code E404` + `npm error 404 Not Found - GET ...`), without stack frames.
 */
export function npmFailure(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^npm (error|ERR!)/.test(line))
    .map((line) => line.replace(/^npm (error|ERR!)\s*/, ""))
    .filter((line) => line && !/^(at |\{|\}|[a-z]\w*: |syscall|errno |A complete log)/.test(line));
  const code = lines.find((line) => line.startsWith("code "));
  const detail = lines.find((line) => !line.startsWith("code "));
  const summary = [code, detail].filter(Boolean).join(": ").slice(0, 500);
  if (summary) return summary;
  return output.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 500);
}
