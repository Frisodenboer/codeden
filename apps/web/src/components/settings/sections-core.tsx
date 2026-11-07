import type { ReasoningEffort, Role } from "@codeden/contracts";
import { ProviderMark } from "@/components/common/bits";
import { KillSwitchButton } from "@/components/factory/kill-switch";
import { AUTONOMY } from "@/components/thread/autonomy";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { type ThemePreference, useThemeStore } from "@/stores/theme";
import { Segmented, SettingRow, SettingsSection, useSettings } from "./settings-ui";

export function GeneralSettings() {
  const { settings, update } = useSettings();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <>
      <SettingsSection title="Appearance">
        <SettingRow label="Theme" help="Dark is the default; light mirrors it.">
          <Segmented<ThemePreference>
            value={preference}
            onChange={(v) => {
              setPreference(v);
              update({ appearance: { theme: v } });
            }}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection
        title="Follow-up prompts"
        description="Suggested next prompts appear as chips when a turn completes."
      >
        <SettingRow label="Show follow-up chips">
          <Switch
            checked={settings.followups.enabled}
            onCheckedChange={(v) => update({ followups: { enabled: v } })}
          />
        </SettingRow>
        <SettingRow
          label="Send on click"
          help="Off: a click fills the composer so you can edit first."
        >
          <Switch
            checked={settings.followups.sendOnClick}
            onCheckedChange={(v) => update({ followups: { sendOnClick: v } })}
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Background work">
        <SettingRow
          label="Automations"
          help="Master switch. Each automation is still off until you enable it."
        >
          <Switch
            checked={settings.automations.enabled}
            onCheckedChange={(v) => update({ automations: { enabled: v } })}
          />
        </SettingRow>
        <SettingRow
          label="Global factory kill switch"
          help={
            settings.factory.killSwitch
              ? "On: no project's factory loop runs."
              : "Stops every project's factory loop and all factory sessions at once."
          }
        >
          <KillSwitchButton scope="global" on={settings.factory.killSwitch} size="xs" />
        </SettingRow>
        <SettingRow
          label="Check for updates"
          help="Asks the npm registry for the latest version once a day. Nothing else is sent."
        >
          <Switch
            checked={settings.updates.check}
            onCheckedChange={(v) => update({ updates: { check: v } })}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}

const roles: { role: Role; label: string; help: string }[] = [
  { role: "orchestrator", label: "Orchestrator", help: "Your front door across projects." },
  { role: "pm", label: "Project managers", help: "Triage, planning and follow-up per project." },
  { role: "agent", label: "Agent sessions", help: "Default for new coding sessions." },
];

export function ProviderSettings() {
  const { settings, update } = useSettings();
  const providers = useSnapshotData((s) => s.runner.providers, []);
  return (
    <>
      <SettingsSection
        title="Installed providers"
        description="Detected on this machine and reused with their own logins."
      >
        {providers.map((p) => (
          <SettingRow
            key={p.id}
            label={p.displayName}
            help={`${p.models.length} models · ${Object.entries(p.capabilities).filter(([, v]) => v).length} capabilities`}
          >
            <div className="flex items-center gap-2">
              <ProviderMark provider={p.id} className="size-5" />
              <span className="rounded-full bg-status-done/12 px-2 py-0.5 text-2xs text-status-done">
                Ready
              </span>
            </div>
          </SettingRow>
        ))}
      </SettingsSection>
      <SettingsSection title="Defaults per role" description="Each role can run on any provider.">
        {roles.map(({ role, label, help }) => {
          const current = settings.providers[role];
          const provider = providers.find((p) => p.id === current.provider) ?? providers[0];
          const model =
            provider?.models.find((m) => m.id === current.model) ??
            provider?.models.find((m) => m.isDefault);
          return (
            <SettingRow key={role} label={label} help={help}>
              <div className="flex gap-2">
                <Select
                  value={current.provider}
                  onValueChange={(v) =>
                    update({ providers: { [role]: { provider: v, model: null } } })
                  }
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={model?.id ?? ""}
                  onValueChange={(v) => update({ providers: { [role]: { model: v } } })}
                  disabled={current.provider === "auto"}
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {provider?.models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={current.effort ?? "default"}
                  onValueChange={(v) =>
                    update({
                      providers: {
                        [role]: { effort: v === "default" ? null : (v as ReasoningEffort) },
                      },
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default effort</SelectItem>
                    {(model?.efforts ?? []).map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SettingRow>
          );
        })}
      </SettingsSection>
    </>
  );
}

export function AutonomySettings() {
  const { settings, update } = useSettings();
  return (
    <SettingsSection
      title="Default autonomy"
      description="Mapped onto each provider's native enforcement. Override per project and per session."
    >
      <div className="grid gap-2 p-3">
        {(Object.keys(AUTONOMY) as (keyof typeof AUTONOMY)[]).map((level) => {
          const a = AUTONOMY[level];
          const active = settings.autonomy.default === level;
          return (
            <button
              key={level}
              type="button"
              onClick={() => update({ autonomy: { default: level } })}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                active ? "border-primary/50 bg-primary/[0.06]" : "border-border hover:bg-accent/40",
              )}
            >
              <a.icon className={cn("mt-0.5 size-4", a.tone)} />
              <span>
                <span className="block text-[13.5px] font-medium">
                  {a.label}
                  {level === "auto" && (
                    <span className="ml-2 text-2xs font-normal text-muted-foreground">
                      recommended
                    </span>
                  )}
                </span>
                <span className="block text-2xs text-muted-foreground">{a.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <SettingRow
        label="Risky actions"
        help="Writes outside the worktree, force pushes, deleting branches, global installs, unlisted network hosts and secrets access always go to your inbox in Auto."
      >
        <span className="text-2xs text-muted-foreground">Always ask</span>
      </SettingRow>
    </SettingsSection>
  );
}

export function UtilitySettings() {
  const { settings, update } = useSettings();
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const jobs = [
    ["followups", "Follow-up suggestions", "When the agent didn't suggest any itself."],
    ["readAloudSummary", "Read-aloud summaries", "Compress long final messages before speaking."],
    ["sessionTitles", "Session titles", "Short titles from the first message."],
    ["noticeSummaries", "Notice summaries", "One-line summaries in PM wake-ups."],
  ] as const;
  return (
    <SettingsSection
      title="Utility model"
      description="One small, cheap model for side jobs. Runs through an installed provider, no extra API key."
    >
      <SettingRow label="Model">
        <Select
          value={
            settings.utilityModel.provider === "auto"
              ? "auto"
              : `${settings.utilityModel.provider}:${settings.utilityModel.model ?? ""}`
          }
          onValueChange={(v) => {
            const [provider = "auto", model = null] = v === "auto" ? ["auto", null] : v.split(":");
            update({ utilityModel: { provider, model } });
          }}
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (smallest available)</SelectItem>
            {providers.flatMap((p) =>
              p.models.map((m) => (
                <SelectItem key={`${p.id}:${m.id}`} value={`${p.id}:${m.id}`}>
                  {p.displayName} · {m.label}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
      </SettingRow>
      {jobs.map(([key, label, help]) => (
        <SettingRow key={key} label={label} help={help}>
          <Switch
            checked={settings.utilityModel.jobs[key]}
            onCheckedChange={(v) => update({ utilityModel: { jobs: { [key]: v } } })}
          />
        </SettingRow>
      ))}
    </SettingsSection>
  );
}
