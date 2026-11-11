import type { InstallSource, UpdateMode } from "@codeden/contracts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdates } from "@/lib/updates";
import { SettingRow, useSettings } from "./settings-ui";

const NPM_HELP: Record<UpdateMode, string> = {
  off: "Never asks the npm registry for new versions.",
  notify:
    "Asks the npm registry for the latest version on start and every 6 hours (nothing else is sent) and offers a one-click update.",
  auto: "Also downloads new versions in the background; they start the next time you open CodeBench.",
};

const DESKTOP_HELP: Record<UpdateMode, string> = {
  off: "Never asks GitHub Releases for new versions.",
  notify:
    "Asks GitHub Releases for the latest version on start and every 6 hours (nothing else is sent) and offers a one-click update.",
  auto: "Also downloads new versions in the background; they install when you quit CodeBench.",
};

/** Help text for where this install gets its updates from. */
export function updateModeHelp(mode: UpdateMode, source: InstallSource | undefined): string {
  return (source === "desktop" ? DESKTOP_HELP : NPM_HELP)[mode];
}

/** Settings > General > Updates (§16, §17): off, notify, or install automatically. */
export function UpdateModeSetting() {
  const { settings, update } = useSettings();
  const { data } = useUpdates();
  const mode = settings.updates.mode;
  return (
    <SettingRow label="Updates" help={updateModeHelp(mode, data?.source)}>
      <Select value={mode} onValueChange={(v) => update({ updates: { mode: v as UpdateMode } })}>
        <SelectTrigger size="sm" className="w-44" data-testid="update-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="notify">Notify me</SelectItem>
          <SelectItem value="auto">Install automatically</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
