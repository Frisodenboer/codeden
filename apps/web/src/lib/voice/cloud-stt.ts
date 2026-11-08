import type { SttEngine, SttResponse } from "@codeden/contracts";
import type { CodeDenClient } from "@/lib/api";
import type { SpeechToText } from "./engines";
import { canRecord, type Recording, startRecording } from "./recorder";
import { toWhisperWav } from "./wav";

/** `en-US` -> `en` (server engines take ISO 639-1 hints). */
export function languageHint(language: string | null | undefined): string | undefined {
  const code = language?.split("-")[0]?.toLowerCase();
  return code && code.length >= 2 ? code : undefined;
}

/**
 * Send a recording to `/api/stt`. Local Whisper takes 16 kHz mono WAV, so the clip is
 * decoded and converted in the browser first; the cloud engines take it as recorded.
 */
export async function transcribeRecording(
  client: CodeDenClient,
  audio: Blob,
  engine: SttEngine,
  language?: string | null,
): Promise<SttResponse> {
  const body = engine === "local" ? await toWhisperWav(audio) : audio;
  return client.voice.stt(body, { engine, language: languageHint(language) });
}

/**
 * Server-side dictation (§11.3): records the microphone with `MediaRecorder` while active,
 * then sends the clip to `/api/stt` (ElevenLabs Scribe, OpenAI or local Whisper) and
 * delivers the transcript once.
 */
export function createCloudStt(client: CodeDenClient, engine: SttEngine): SpeechToText {
  let recording: Promise<Recording | null> | null = null;
  return {
    supported: canRecord(),
    start({ language, onText, onEnd, onError }) {
      const started = startRecording().catch((error: unknown) => {
        onError(error instanceof Error ? error.message : String(error));
        onEnd();
        return null;
      });
      recording = started;
      void started.then(async (rec) => {
        if (!rec) return;
        const audio = await rec.stopped;
        if (recording === started) recording = null;
        if (audio.size === 0) return onEnd();
        try {
          const res = await transcribeRecording(client, audio, engine, language);
          if (res.text.trim()) onText(res.text.trim(), true);
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
        }
        onEnd();
      });
    },
    stop() {
      void recording?.then((rec) => rec?.stop());
    },
  };
}
