import { Cpu } from "lucide-react";
import {
  useLocalStt,
  useLocalSttActions,
  WhisperModelSelect,
  WhisperModelStatus,
} from "@/components/settings/local-whisper";
import { WhisperTest } from "@/components/settings/local-whisper-test";
import { useSettings } from "@/components/settings/settings-ui";
import { Switch } from "@/components/ui/switch";

/**
 * First-run setup (§14): optional local Whisper for dictation. Turning it on picks the
 * engine and starts the download, which carries on in the background if the user moves on;
 * nothing here blocks finishing setup.
 */
export function LocalWhisperCard({ recommended }: { recommended: boolean }) {
  const { settings, update } = useSettings();
  const local = useLocalStt();
  const actions = useLocalSttActions();
  const dictation = settings.voice.dictation;
  const using = dictation.engine === "local";
  const model = local.data?.models.find((m) => m.id === dictation.local.model);
  const supported = local.data?.supported ?? true;
  return (
    <div className="px-4 py-3.5" data-testid="local-whisper-card">
      <div className="flex items-center gap-3">
        <Cpu className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">Use local Whisper for dictation</div>
          <div className="text-2xs text-muted-foreground">
            {!supported
              ? (local.data?.unsupportedReason ?? "Not available on this machine.")
              : recommended
                ? "Recommended here: this browser has no speech recognition. Runs offline on this machine."
                : "Optional. Private and offline: transcribes on this machine and works in any browser."}
          </div>
        </div>
        <Switch
          aria-label="Use local Whisper for dictation"
          checked={using}
          disabled={!supported}
          onCheckedChange={(on) => {
            update({ voice: { dictation: { engine: on ? "local" : "browser" } } });
            if (on && (model?.state === "missing" || model?.state === "failed")) {
              void actions.download(model.id);
            }
          }}
        />
      </div>
      {using && (
        <div className="mt-3 flex flex-col gap-3 pl-7">
          <WhisperModelSelect
            status={local.data}
            value={dictation.local.model}
            onChange={(id) => update({ voice: { dictation: { local: { model: id } } } })}
          />
          <WhisperModelStatus status={local.data} modelId={dictation.local.model} />
          <WhisperTest disabled={model?.state !== "installed"} language={dictation.language} />
        </div>
      )}
    </div>
  );
}
