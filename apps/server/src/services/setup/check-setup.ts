import { existsSync } from "node:fs";
import { Settings, type SetupStatus } from "@codeden/contracts";
import { homePaths } from "../../paths";
import { SettingsStore } from "../../settings-store";
import { type Exec, runTool } from "../exec";
import { SetupService } from "./setup-service";

/**
 * Run the first-run detection checks (§14) outside a server, e.g. for `codeden doctor`.
 * Reads the home's settings when they exist and never writes anything.
 */
export async function checkSetup(opts: { home: string; exec?: Exec }): Promise<SetupStatus> {
  const file = homePaths(opts.home).settings;
  const current = existsSync(file) ? new SettingsStore(file).get() : Settings.parse({});
  const settings = { get: () => current, update: () => current };
  return new SetupService({ exec: opts.exec ?? runTool, settings }).status({ refresh: true });
}
