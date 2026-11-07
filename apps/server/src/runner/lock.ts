import { RunnerLock } from "@codeden/contracts";
import { readJsonFile } from "../json-file";

/** True when a process with this pid exists (EPERM still means it exists). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Read the runner lock file; `undefined` when missing, invalid, or its process is gone. */
export function readLiveRunnerLock(file: string): RunnerLock | undefined {
  const parsed = RunnerLock.safeParse(readJsonFile(file));
  if (!parsed.success) return undefined;
  return isProcessAlive(parsed.data.pid) ? parsed.data : undefined;
}
