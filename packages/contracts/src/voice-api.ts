import { z } from "zod";

/**
 * Voice engines on the server (§11.3). The browser's speech APIs stay the default; these
 * routes proxy ElevenLabs (text to speech, Scribe) and OpenAI (transcription) with API keys
 * from the OS keychain, so keys never reach the browser, and run local Whisper with a
 * runtime and model downloaded on demand.
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

/** Engines that transcribe on the server: the cloud engines and local Whisper. */
export const SttEngine = z.enum(["elevenlabs", "openai", "local"]);
export type SttEngine = z.infer<typeof SttEngine>;

/**
 * `POST /api/stt?engine=&language=`: the body is the recorded audio (raw bytes with an
 * `audio/*` content type, or multipart with a `file` field), up to 25 MB. `engine` defaults
 * to `settings.voice.dictation.engine` (when that is `browser`, ElevenLabs). The `local`
 * engine only takes WAV, 16-bit PCM, mono at `LOCAL_STT_SAMPLE_RATE`, at most
 * `LOCAL_STT_MAX_SECONDS` long (the UI converts the recording before uploading).
 */
export const SttQuery = z.object({
  engine: SttEngine.optional(),
  /** ISO 639-1 hint, e.g. `en`. */
  language: z.string().min(2).max(10).optional(),
});
export type SttQuery = z.infer<typeof SttQuery>;

export const SttResponse = z.object({
  text: z.string(),
  language: z.string().nullable(),
  engine: SttEngine,
  /** How long the server spent transcribing, in milliseconds (local engine). */
  elapsedMs: z.number().nonnegative().optional(),
});
export type SttResponse = z.infer<typeof SttResponse>;

// ---------------------------------------------------------------- local Whisper (§11.3)

/**
 * Dictation engines (`settings.voice.dictation.engine`): the browser's speech recognition,
 * a cloud engine through the server, or `local` Whisper running on the CodeDen server.
 */
export const DictationEngine = z.enum(["browser", "elevenlabs", "openai", "local"]);
export type DictationEngine = z.infer<typeof DictationEngine>;

/**
 * Local Whisper models CodeDen can download. `.en` models are English-only (more accurate
 * for English at the same size); the others detect or take a language.
 */
export const WhisperModelId = z.enum(["tiny", "tiny.en", "base", "base.en", "small", "small.en"]);
export type WhisperModelId = z.infer<typeof WhisperModelId>;

/** Audio format the local engine accepts: WAV, 16-bit PCM, mono, at this sample rate. */
export const LOCAL_STT_SAMPLE_RATE = 16_000;
/** Longest clip the local engine transcribes in one request, in seconds. */
export const LOCAL_STT_MAX_SECONDS = 120;

/**
 * Where one download (the runtime or a model) stands. `missing`: not on disk;
 * `downloading`: in progress (bytes below); `installed`: verified and on disk;
 * `failed`: the last attempt failed (`error`), a retry resumes or restarts it.
 */
export const LocalSttDownloadState = z.enum(["missing", "downloading", "installed", "failed"]);
export type LocalSttDownloadState = z.infer<typeof LocalSttDownloadState>;

const downloadFields = {
  state: LocalSttDownloadState,
  /** Bytes received so far (while downloading). */
  receivedBytes: z.int().nonnegative(),
  /** Download size in bytes (pinned, so known before the download starts). */
  totalBytes: z.int().nonnegative(),
  /** Size on disk when installed. */
  sizeOnDisk: z.int().nonnegative().nullable(),
  /** Why the last attempt failed. */
  error: z.string().nullable(),
};

/** The Whisper runtime: a prebuilt native library for this platform, downloaded on demand. */
export const LocalSttRuntime = z.object({
  /** Runtime version CodeDen pins. */
  version: z.string(),
  ...downloadFields,
});
export type LocalSttRuntime = z.infer<typeof LocalSttRuntime>;

/** One downloadable model, with a speed and accuracy hint for the picker. */
export const LocalSttModel = z.object({
  id: WhisperModelId,
  /** e.g. `Base (English)`. */
  label: z.string(),
  /** Speed and accuracy hint, e.g. `Fast, good accuracy`. */
  hint: z.string(),
  englishOnly: z.boolean(),
  /** The suggested default. */
  recommended: z.boolean(),
  ...downloadFields,
});
export type LocalSttModel = z.infer<typeof LocalSttModel>;

/** `GET /api/voice/local`: the local Whisper engine on this machine. */
export const LocalSttStatus = z.object({
  /** False on platforms without a prebuilt runtime (`unsupportedReason` says why). */
  supported: z.boolean(),
  /** `process.platform-process.arch` of the server, e.g. `win32-x64`. */
  platform: z.string(),
  unsupportedReason: z.string().nullable(),
  runtime: LocalSttRuntime,
  models: z.array(LocalSttModel),
  /** Folder holding the models. */
  location: z.string(),
});
export type LocalSttStatus = z.infer<typeof LocalSttStatus>;

/**
 * `POST /api/voice/local/models/:id/download` starts (or joins) the download of the runtime
 * and that model; `DELETE /api/voice/local/models/:id` cancels or deletes it. Both return
 * the new `LocalSttStatus`. The UI polls `GET /api/voice/local` while anything downloads.
 */
export const LocalSttModelParams = z.object({ id: WhisperModelId });
export type LocalSttModelParams = z.infer<typeof LocalSttModelParams>;
