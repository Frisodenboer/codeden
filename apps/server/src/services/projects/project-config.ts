import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectConfigFile } from "@codeden/contracts";

/**
 * The repository's `.codeden/project.json` (§9) read from the project root, or null when it is
 * missing or invalid. Small and read on demand (new sessions), so edits apply right away.
 */
export function readProjectConfig(projectPath: string): ProjectConfigFile | null {
  const file = join(projectPath, ".codeden", "project.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = ProjectConfigFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The provider new sessions in a project default to: the project's own setting, else the
 * repository's `.codeden/project.json` `defaultProvider`, else null (role default / auto).
 */
export function projectDefaultProvider(project: {
  defaultProvider: string | null;
  path: string;
}): string | null {
  return project.defaultProvider ?? readProjectConfig(project.path)?.defaultProvider ?? null;
}
