import { z } from "zod";

/**
 * Optional cloud voice engines (§11.3). The browser's speech APIs stay the default; these
 * routes proxy ElevenLabs (text to speech, Scribe) and OpenAI (transcription) with API keys
 * from the OS keychain, so keys never reach the browser.
 */

/** ElevenLabs MP3 output formats (`codec_sampleRate_bitrate`). */
export const TtsOutputFormat = z.enum([
  "mp3_22050_32",
  "mp3_44100_64",
  "mp3_44100_128",
  "mp3_44100_192",
]);
export type TtsOutputFormat = z.infer<typeof TtsOutputFormat>;

/**
 * `POST /api/tts`: streams `audio/mpeg`. `voiceId` defaults to
 * `settings.voice.readAloud.voice`, then a stock voice; `modelId` to a low-latency model.
 */
export const TtsRequest = z.object({
  text: z.string().min(1).max(5_000),
  voiceId: z.string().min(1).max(100).optional(),
  modelId: z.string().min(1).max(100).optional(),
  outputFormat: TtsOutputFormat.optional(),
});
export type TtsRequest = z.infer<typeof TtsRequest>;

/** One ElevenLabs voice for the voice picker. */
export const VoiceInfo = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  previewUrl: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type VoiceInfo = z.infer<typeof VoiceInfo>;

/** `GET /api/voice/voices`. */
export const VoiceListResponse = z.object({ voices: z.array(VoiceInfo) });
export type VoiceListResponse = z.infer<typeof VoiceListResponse>;

/**
 * `POST /api/stt?engine=&language=`: the body is the recorded audio (raw bytes with an
 * `audio/*` content type, or multipart with a `file` field), up to 25 MB. `engine` defaults
 * to `settings.voice.dictation.engine` (when that is `browser`, ElevenLabs).
 */
export const SttQuery = z.object({
  engine: z.enum(["elevenlabs", "openai"]).optional(),
  /** ISO 639-1 hint, e.g. `en`. */
  language: z.string().min(2).max(10).optional(),
});
export type SttQuery = z.infer<typeof SttQuery>;

export const SttResponse = z.object({
  text: z.string(),
  language: z.string().nullable(),
  engine: z.enum(["elevenlabs", "openai"]),
});
export type SttResponse = z.infer<typeof SttResponse>;
