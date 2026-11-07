import type { UpdateMode } from "@codeden/contracts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow, useSettings } from "./settings-ui";

const HELP: Record<UpdateMode, string> = {
  off: "Never asks the npm registry for new versions.",
  notify:
    "Asks the npm registry for the latest version on start and every 6 hours (nothing else is sent) and offers a one-click update.",
  auto: "Also downloads new versions in the background; they start the next time you open CodeDen.",
};

/** Settings > General > Updates (§16): off, notify, or install automatically. */
export function UpdateModeSetting() {
  const { settings, update } = useSettings();
  const mode = settings.updates.mode;
  return (
    <SettingRow label="Updates" help={HELP[mode]}>
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
