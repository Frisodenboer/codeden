import type { RunnerCommandResult, UserInput } from "@codeden/contracts";

type SetupSteps = RunnerCommandResult<"workspace.prepare">["setup"];

/**
 * What the agent is told when a worktree setup command failed (§9 setup scripts): the command,
 * its exit code and the end of its output. Null when every command succeeded. Setup stops at
 * the first failure, so there is at most one.
 */
export function setupFailureNote(setup: SetupSteps): string | null {
  const failed = setup?.find((step) => !step.ok);
  if (!failed) return null;
  const exit = failed.exitCode === null ? "timed out" : `exit ${failed.exitCode}`;
  const head = `Setup command \`${failed.command}\` failed (${exit})`;
  return failed.outputTail ? `${head}:\n\`\`\`\n${failed.outputTail}\n\`\`\`` : `${head}.`;
}

/** The agent's input with a setup failure note in front, so its first turn knows. */
export function withSetupNote(
  input: UserInput | undefined,
  note: string | null,
): UserInput | undefined {
  if (!input || !note) return input;
  return { ...input, text: `${note}\n\n${input.text}` };
}
