import { useLocalStt, WhisperModelSelect, WhisperModelStatus } from "./local-whisper";
import { WhisperTest } from "./local-whisper-test";
import { SettingRow, useSettings } from "./settings-ui";

/** Settings › Voice rows for local Whisper (§11.3): model, download status and a test. */
export function LocalWhisperRows() {
  const { settings, update } = useSettings();
  const dictation = settings.voice.dictation;
  const local = useLocalStt();
  const model = local.data?.models.find((m) => m.id === dictation.local.model);
  return (
    <>
      <SettingRow
        label="Whisper model"
        help={
          local.error
            ? `Couldn't read the local engine: ${local.error.message}`
            : `Models are downloaded once into ${local.data?.location ?? "the CodeBench folder"} and run on this machine.`
        }
        stacked
      >
        <div className="flex flex-col gap-3">
          <WhisperModelSelect
            status={local.data}
            value={dictation.local.model}
            onChange={(id) => update({ voice: { dictation: { local: { model: id } } } })}
          />
          <WhisperModelStatus status={local.data} modelId={dictation.local.model} />
        </div>
      </SettingRow>
      <SettingRow label="Try it" help="Say a sentence after pressing Test." stacked>
        <WhisperTest disabled={model?.state !== "installed"} language={dictation.language} />
      </SettingRow>
    </>
  );
}
