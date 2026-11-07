import { rmSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../json-file";
import { appDir } from "./app-dir";

/**
 * The outcome of the last hand-over to another version, written by the `codeden` CLI when the
 * new version failed to start and it went back to the old one. The next server reads it once
 * to show the failure in the UI.
 */
export interface UpdateResult {
  from: string;
  to: string;
  ok: boolean;
  error?: string;
  at: string;
}

function resultFile(home: string): string {
  return join(appDir(home), "last-update.json");
}

export function writeUpdateResult(home: string, result: Omit<UpdateResult, "at">): void {
  writeJsonFile(resultFile(home), { ...result, at: new Date().toISOString() });
}

/** Read and delete the last result, if any. */
export function takeUpdateResult(home: string): UpdateResult | null {
  const file = resultFile(home);
  const value = readJsonFile(file) as Partial<UpdateResult> | undefined;
  if (!value) return null;
  rmSync(file, { force: true });
  if (typeof value.to !== "string" || typeof value.ok !== "boolean") return null;
  return {
    from: String(value.from ?? ""),
    to: value.to,
    ok: value.ok,
    error: typeof value.error === "string" ? value.error : undefined,
    at: String(value.at ?? ""),
  };
}
