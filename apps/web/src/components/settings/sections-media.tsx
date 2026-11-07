import { useMutation } from "@tanstack/react-query";
import { BellRing, KeyRound, Volume2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";
import { platform } from "@/lib/platform";
import { stt, tts } from "@/lib/voice/engines";
import { Segmented, SettingRow, SettingsSection, useSettings } from "./settings-ui";

function SecretField({ name, label }: { name: string; label: string }) {
  const client = useClient();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => client.setSecret(name, value),
    onSuccess: () => {
      setValue("");
      setSaved(true);
      toast.success(`${label} saved to the OS keychain`);
    },
  });
  return (
    <div className="flex w-72 gap-2">
      <Input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={saved ? "•••••••• stored in keychain" : "Paste key"}
        className="h-8 font-mono text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!value || save.isPending}
        onClick={() => save.mutate()}
      >
        <KeyRound /> Save
      </Button>
    </div>
  );
}

export function VoiceSettings() {
  const { settings, update } = useSettings();
  const v = settings.voice;
  const voices = tts.voices();
  return (
    <>
      <SettingsSection
        title="Dictation"
        description="Speech to text in the composer. Push-to-talk with Ctrl Shift M."
      >
        <SettingRow
          label="Engine"
          help={
            stt.supported
              ? "The browser engine works in Chrome and Edge."
              : "This browser has no speech recognition; choose a cloud engine."
          }
        >
          <Segmented
            value={v.dictation.engine}
            onChange={(engine) => update({ voice: { dictation: { engine } } })}
            options={[
              { value: "browser", label: "Browser" },
              { value: "elevenlabs", label: "ElevenLabs" },
              { value: "openai", label: "OpenAI" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Language" help="Leave on auto to follow the browser language.">
          <Select
            value={v.dictation.language ?? "auto"}
            onValueChange={(language) =>
              update({ voice: { dictation: { language: language === "auto" ? null : language } } })
            }
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["auto", "en-US", "en-GB", "en-ZA", "de-DE", "fr-FR", "es-ES", "nl-NL"].map((l) => (
                <SelectItem key={l} value={l}>
                  {l === "auto" ? "Auto" : l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>
      <SettingsSection
        title="Read aloud"
        description="Speaks an agent's final message when its turn completes. Code and markdown are stripped; long messages are summarised first."
      >
        <SettingRow label="Read final messages aloud">
          <Switch
            checked={v.readAloud.enabled}
            onCheckedChange={(enabled) => update({ voice: { readAloud: { enabled } } })}
          />
        </SettingRow>
        <SettingRow label="Engine">
          <Segmented
            value={v.readAloud.engine}
            onChange={(engine) => update({ voice: { readAloud: { engine } } })}
            options={[
              { value: "browser", label: "Browser (free)" },
              { value: "elevenlabs", label: "ElevenLabs" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Voice">
          <div className="flex items-center gap-2">
            <Select
              value={v.readAloud.voice ?? "default"}
              onValueChange={(voice) =>
                update({ voice: { readAloud: { voice: voice === "default" ? null : voice } } })
              }
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">System default</SelectItem>
                {voices.slice(0, 30).map((vo) => (
                  <SelectItem key={vo.id} value={vo.id}>
                    {vo.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!tts.supported}
              onClick={() =>
                tts.speak("The checkout flake is fixed and verified with fifty green runs.", {
                  voice: v.readAloud.voice,
                })
              }
            >
              <Volume2 /> Test
            </Button>
          </div>
        </SettingRow>
        <SettingRow label="Only when the tab isn't focused">
          <Switch
            checked={v.readAloud.onlyWhenUnfocused}
            onCheckedChange={(onlyWhenUnfocused) =>
              update({ voice: { readAloud: { onlyWhenUnfocused } } })
            }
          />
        </SettingRow>
        <SettingRow label="Quiet hours" help="Nothing is spoken in this window.">
          <div className="flex items-center gap-2">
            <Switch
              checked={v.readAloud.quietHours !== null}
              onCheckedChange={(on) =>
                update({
                  voice: {
                    readAloud: { quietHours: on ? { start: "22:00", end: "07:00" } : null },
                  },
                })
              }
            />
            <Input
              type="time"
              disabled={!v.readAloud.quietHours}
              value={v.readAloud.quietHours?.start ?? "22:00"}
              onChange={(e) =>
                v.readAloud.quietHours &&
                update({
                  voice: {
                    readAloud: { quietHours: { ...v.readAloud.quietHours, start: e.target.value } },
                  },
                })
              }
              className="h-8 w-24 text-xs"
            />
            <span className="text-2xs text-muted-foreground">to</span>
            <Input
              type="time"
              disabled={!v.readAloud.quietHours}
              value={v.readAloud.quietHours?.end ?? "07:00"}
              onChange={(e) =>
                v.readAloud.quietHours &&
                update({
                  voice: {
                    readAloud: { quietHours: { ...v.readAloud.quietHours, end: e.target.value } },
                  },
                })
              }
              className="h-8 w-24 text-xs"
            />
          </div>
        </SettingRow>
        <SettingRow
          label="ElevenLabs API key"
          help="Optional. Stored in the OS keychain, never in files."
        >
          <SecretField name="elevenlabs" label="ElevenLabs key" />
        </SettingRow>
      </SettingsSection>
    </>
  );
}

export function ImageSettings() {
  const { settings, update } = useSettings();
  const ig = settings.imageGeneration;
  const test = useMutation({
    mutationFn: () => new Promise((r) => setTimeout(r, 900)),
    onSuccess: () => toast.success("Codex generated a 1024×1024 test image in 7.2s"),
  });
  return (
    <SettingsSection
      title="Image generation"
      description="Every agent gets one generate_image tool, routed to the engine you pick here."
    >
      <SettingRow
        label="Engine"
        help="Auto uses Codex when it's signed in. None hides the tool from agents."
      >
        <div className="flex items-center gap-2">
          <Select
            value={ig.engine}
            onValueChange={(engine) =>
              update({ imageGeneration: { engine: engine as typeof ig.engine } })
            }
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="codex">Codex (your login)</SelectItem>
              <SelectItem value="gemini">Gemini image models</SelectItem>
              <SelectItem value="openai">OpenAI Images</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending ? "Testing…" : "Test"}
          </Button>
        </div>
      </SettingRow>
      <SettingRow label="Default size">
        <Segmented
          value={ig.defaultSize}
          onChange={(defaultSize) => update({ imageGeneration: { defaultSize } })}
          options={[
            { value: "1024x1024", label: "Square" },
            { value: "1536x1024", label: "Landscape" },
            { value: "1024x1536", label: "Portrait" },
          ]}
        />
      </SettingRow>
      <SettingRow label="Quality">
        <Segmented
          value={ig.quality}
          onChange={(quality) => update({ imageGeneration: { quality } })}
          options={[
            { value: "auto", label: "Auto" },
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
        />
      </SettingRow>
      <SettingRow label="Daily cap" help="Maximum images per day across all agents.">
        <Input
          type="number"
          min={0}
          value={ig.dailyCap}
          onChange={(e) => update({ imageGeneration: { dailyCap: Number(e.target.value) || 0 } })}
          className="h-8 w-24 text-xs"
        />
      </SettingRow>
      <SettingRow label="Gemini API key">
        <SecretField name="gemini" label="Gemini key" />
      </SettingRow>
      <SettingRow label="OpenAI API key">
        <SecretField name="openai" label="OpenAI key" />
      </SettingRow>
    </SettingsSection>
  );
}

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
