import type { CodeDenClient } from "@/lib/api";
import type { SpeechToText } from "./engines";

/** `en-US` -> `en` (cloud engines take ISO 639-1 hints). */
export function languageHint(language: string | null | undefined): string | undefined {
  const code = language?.split("-")[0]?.toLowerCase();
  return code && code.length >= 2 ? code : undefined;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

/**
 * Cloud dictation (§11.3): records the microphone with `MediaRecorder` while active, then
 * sends the clip to `/api/stt` (ElevenLabs Scribe or OpenAI) and delivers the transcript once.
 */
export function createCloudStt(
  client: CodeDenClient,
  engine: "elevenlabs" | "openai",
): SpeechToText {
  let recorder: MediaRecorder | null = null;
  const supported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";
  return {
    supported,
    start({ language, onText, onEnd, onError }) {
      void (async () => {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          onError("Microphone access was blocked.");
          onEnd();
          return;
        }
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder = rec;
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = async () => {
          for (const track of stream.getTracks()) track.stop();
          recorder = null;
          const audio = new Blob(chunks, { type: (rec.mimeType || "audio/webm").split(";")[0] });
          if (audio.size === 0) return onEnd();
          try {
            const res = await client.voice.stt(audio, { engine, language: languageHint(language) });
            if (res.text.trim()) onText(res.text.trim(), true);
          } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
          }
          onEnd();
        };
        rec.start();
      })();
    },
    stop() {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    },
  };
}
