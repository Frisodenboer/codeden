import { BellRing } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { platform } from "@/lib/platform";
import { SettingRow, SettingsSection, useSettings } from "./settings-ui";

export function NotificationSettings() {
  const { settings, update } = useSettings();
  const [permission, setPermission] = useState(platform.notificationPermission());
  return (
    <SettingsSection
      title="Notifications"
      description="How CodeDen tells you something is waiting."
    >
      <SettingRow label="Toasts" help="In-app toasts for new inbox items and failures.">
        <Switch
          checked={settings.notifications.toasts}
          onCheckedChange={(toasts) => update({ notifications: { toasts } })}
        />
      </SettingRow>
      <SettingRow
        label="Browser notifications"
        help={
          permission === "denied"
            ? "Blocked in your browser settings."
            : "Shown when the CodeDen tab isn't focused."
        }
      >
        <div className="flex items-center gap-2">
          {permission !== "granted" && permission !== "unsupported" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => setPermission(await platform.requestNotificationPermission())}
            >
              <BellRing /> Allow
            </Button>
          )}
          <Switch
            checked={settings.notifications.browser}
            disabled={permission === "unsupported"}
            onCheckedChange={(browser) => update({ notifications: { browser } })}
          />
        </div>
      </SettingRow>
      <SettingRow label="Send a test notification">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            toast("Approval needed", { description: "Force push to codeden/fix-checkout-flake" });
            platform.notify("Approval needed", {
              body: "Force push to codeden/fix-checkout-flake",
            });
          }}
        >
          Test
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}
