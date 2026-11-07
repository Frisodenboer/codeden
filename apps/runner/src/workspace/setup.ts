import type { RunnerEvent } from "@codeden/contracts";
import type { ProcessSupervisor } from "../process/supervisor";

export interface SetupStep {
  command: string;
  exitCode: number | null;
  ok: boolean;
}

export interface RunSetupOptions {
  sessionId: string;
  cwd: string;
  commands: string[];
  supervisor: ProcessSupervisor;
  emit: (event: RunnerEvent) => void;
  /** Per-command timeout. Default 30 minutes. */
  timeoutMs?: number;
  /** Flush buffered output at least this often. Default 250ms. */
  flushMs?: number;
}

/** Max output journaled per command; the rest is dropped with a notice. */
const MAX_OUTPUT = 1024 * 1024;
const FLUSH_BYTES = 16 * 1024;

/**
 * Run setup commands in order in a worktree, streaming output as `workspace.setup` events
 * (batched, capped per command). Stops at the first failing command.
 */
export async function runSetup(opts: RunSetupOptions): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];
  for (const command of opts.commands) {
    const { sessionId, emit } = opts;
    emit({ kind: "workspace.setup", sessionId, status: "running", command });
    let buffer = "";
    let total = 0;
    let truncated = false;
    const flush = () => {
      if (!buffer) return;
      emit({ kind: "workspace.setup", sessionId, status: "running", command, output: buffer });
      buffer = "";
    };
    const timer = setInterval(flush, opts.flushMs ?? 250);
    const result = await opts.supervisor.runShell(command, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      label: `setup: ${command}`,
      onOutput: (chunk) => {
        if (truncated) return;
        if (total + chunk.length > MAX_OUTPUT) {
          buffer += `${chunk.slice(0, MAX_OUTPUT - total)}\n[output truncated]\n`;
          truncated = true;
        } else {
          buffer += chunk;
        }
        total += chunk.length;
        if (buffer.length >= FLUSH_BYTES) flush();
      },
    });
    clearInterval(timer);
    flush();
    const ok = result.exitCode === 0 && !result.timedOut;
    emit({
      kind: "workspace.setup",
      sessionId,
      status: ok ? "succeeded" : "failed",
      command,
      ...(result.timedOut ? { output: "[timed out]" } : {}),
    });
    steps.push({ command, exitCode: result.exitCode, ok });
    if (!ok) break;
  }
  return steps;
}
