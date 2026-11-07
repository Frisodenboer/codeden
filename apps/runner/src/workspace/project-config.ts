import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectConfigFile } from "@codeden/contracts";

export const PROJECT_CONFIG_PATH = ".codeden/project.json";

/**
 * Read `.codeden/project.json` from a checkout. `null` when the file is missing;
 * `error` is set when it exists but is not valid JSON or fails the schema.
 */
export async function readProjectConfig(
  dir: string,
): Promise<{ config: ProjectConfigFile | null; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(join(dir, PROJECT_CONFIG_PATH), "utf8");
  } catch {
    return { config: null };
  }
  try {
    const parsed = ProjectConfigFile.safeParse(JSON.parse(raw));
    if (parsed.success) return { config: parsed.data };
    return { config: null, error: `${PROJECT_CONFIG_PATH}: ${parsed.error.message}` };
  } catch (error) {
    return { config: null, error: `${PROJECT_CONFIG_PATH}: ${(error as Error).message}` };
  }
}
