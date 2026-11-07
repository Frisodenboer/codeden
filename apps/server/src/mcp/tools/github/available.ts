import type { AppServices } from "../../../services/container";
import type { ToolAvailabilityContext } from "../../define";

/**
 * GitHub tools are listed only for callers in a GitHub project (§9: local-only projects get no
 * issue, PR or evidence flow). Without a caller context they stay listed.
 */
export function inGithubProject(services: AppServices, caller?: ToolAvailabilityContext): boolean {
  if (!caller) return true;
  if (!caller.projectId) return false;
  try {
    return services.projects.get(caller.projectId).kind === "github";
  } catch {
    return false;
  }
}
