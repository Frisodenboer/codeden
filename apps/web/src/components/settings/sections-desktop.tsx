import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { platform } from "@/lib/platform";
import { SettingRow, SettingsSection, useSettings } from "./settings-ui";

/**
 * Settings > App (§17): OS integration offered by the desktop app. Shown only when the
 * platform has it (`capabilities.osIntegration`); the desktop app applies changes live.
 */
export function DesktopSettings() {
  const { settings, update } = useSettings();
  const { data: loginSupported = false } = useQuery({
    queryKey: ["platform", "launch-at-login"],
    queryFn: () => platform.launchAtLoginSupported(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const desktop = settings.desktop;
  return (
    <SettingsSection title="App" description="How CodeDen behaves as an app on this computer.">
      <SettingRow
        label="Open at login"
        help={
          loginSupported
            ? "Start CodeDen in the tray when you log in, so agents and automations are ready."
            : "Not available for this kind of install."
        }
      >
        <Switch
          data-testid="launch-at-login"
          checked={desktop.launchAtLogin}
          disabled={!loginSupported}
          onCheckedChange={(launchAtLogin) => update({ desktop: { launchAtLogin } })}
        />
      </SettingRow>
      <SettingRow
        label="Keep running in the tray"
        help="Closing the window leaves CodeDen in the tray (menu bar on macOS). Quit from its menu."
      >
        <Switch
          checked={desktop.closeToTray}
          onCheckedChange={(closeToTray) => update({ desktop: { closeToTray } })}
        />
      </SettingRow>
      <SettingRow
        label="Keep the computer awake"
        help="Prevent sleep while an agent is running. The display can still turn off."
      >
        <Switch
          checked={desktop.keepAwake}
          onCheckedChange={(keepAwake) => update({ desktop: { keepAwake } })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
