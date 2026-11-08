import type { SttEngine, SttResponse, TtsRequest, VoiceInfo } from "@codeden/contracts";
import type { SettingsStore } from "../../settings-store";
import { ServiceError } from "../errors";
import type { SecretStore } from "../secrets";
import type { LocalSttService } from "./local/local-stt-service";

/** A stock ElevenLabs voice used when none is chosen in Settings. */
export const DEFAULT_ELEVENLABS_VOICE = "JBFqnCBsd6RMkjVDRZzb";
/** Low-latency ElevenLabs model for read-aloud. */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5";
export const ELEVENLABS_STT_MODEL = "scribe_v2";
export const OPENAI_STT_MODEL = "gpt-4o-mini-transcribe";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface VoiceServiceDeps {
  secrets: SecretStore;
  settings: SettingsStore;
  /** Local Whisper, for the `local` engine. */
  local?: LocalSttService;
  /** Overridable for tests. */
  elevenLabsBaseUrl?: string;
  openAiBaseUrl?: string;
  fetch?: typeof fetch;
}

/** Audio uploaded for transcription. */
export interface AudioUpload {
  bytes: Uint8Array;
  mediaType: string;
  fileName: string;
}

/**
 * Cloud voice engines (§11.3), opt-in next to the browser's speech APIs: ElevenLabs text to
 * speech (streamed MP3) and voices, and speech to text through ElevenLabs Scribe or OpenAI.
 * Keys come from the keychain and never leave the server.
 */
export class VoiceService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: VoiceServiceDeps) {
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  }

  private get elevenLabs(): string {
    return this.deps.elevenLabsBaseUrl ?? "https://api.elevenlabs.io";
  }

  private get openAi(): string {
    return this.deps.openAiBaseUrl ?? "https://api.openai.com";
  }

  async voices(): Promise<VoiceInfo[]> {
    const key = await this.key("elevenlabs.apiKey", "ElevenLabs");
    const res = await this.call(`${this.elevenLabs}/v2/voices?page_size=100`, {
      headers: { "xi-api-key": key },
    });
    const body = (await res.json()) as { voices?: Array<Record<string, unknown>> };
    return (body.voices ?? []).map((v) => ({
      id: String(v.voice_id ?? ""),
      name: String(v.name ?? ""),
      ...(typeof v.category === "string" ? { category: v.category } : {}),
      ...(typeof v.description === "string" && v.description ? { description: v.description } : {}),
      ...(typeof v.preview_url === "string" ? { previewUrl: v.preview_url } : {}),
      ...(v.labels && typeof v.labels === "object"
        ? { labels: v.labels as Record<string, string> }
        : {}),
    }));
  }

  /** Start ElevenLabs synthesis; the caller streams `response.body` (MP3) to the browser. */
  async speak(req: TtsRequest, signal?: AbortSignal): Promise<Response> {
    const key = await this.key("elevenlabs.apiKey", "ElevenLabs");
    const voice =
      req.voiceId ?? this.deps.settings.get().voice.readAloud.voice ?? DEFAULT_ELEVENLABS_VOICE;
    const format = req.outputFormat ?? "mp3_44100_128";
    const url = `${this.elevenLabs}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=${format}`;
    return this.call(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.text, model_id: req.modelId ?? DEFAULT_ELEVENLABS_MODEL }),
      signal,
    });
  }

  /** Transcribe recorded audio with the chosen (or configured) engine. */
  async transcribe(
    audio: AudioUpload,
    opts: { engine?: SttEngine; language?: string; signal?: AbortSignal },
  ): Promise<SttResponse> {
    if (audio.bytes.length === 0) throw new ServiceError(400, "empty_audio", "No audio was sent");
    if (audio.bytes.length > MAX_AUDIO_BYTES) {
      throw new ServiceError(413, "audio_too_large", "Audio is larger than 25 MB");
    }
    const configured = this.deps.settings.get().voice.dictation;
    const engine =
      opts.engine ??
      (configured.engine === "openai" || configured.engine === "local"
        ? configured.engine
        : "elevenlabs");
    const language = opts.language ?? configured.language ?? undefined;
    if (engine === "local") {
      if (!this.deps.local) {
        throw new ServiceError(503, "local_unavailable", "Local Whisper is not available");
      }
      return this.deps.local.transcribe(audio.bytes, { language, signal: opts.signal });
    }
    const form = new FormData();
    form.append(
      "file",
      new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: audio.mediaType }),
      audio.fileName,
    );
    if (engine === "elevenlabs") {
      const key = await this.key("elevenlabs.apiKey", "ElevenLabs");
      form.append("model_id", ELEVENLABS_STT_MODEL);
      if (language) form.append("language_code", language);
      const res = await this.call(`${this.elevenLabs}/v1/speech-to-text`, {
        method: "POST",
        headers: { "xi-api-key": key },
        body: form,
        signal: opts.signal,
      });
      const body = (await res.json()) as { text?: string; language_code?: string };
      return { text: body.text?.trim() ?? "", language: body.language_code ?? null, engine };
    }
    const key = await this.key("openai.apiKey", "OpenAI");
    form.append("model", OPENAI_STT_MODEL);
    if (language) form.append("language", language);
    const res = await this.call(`${this.openAi}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: opts.signal,
    });
    const body = (await res.json()) as { text?: string; language?: string };
    return { text: body.text?.trim() ?? "", language: body.language ?? language ?? null, engine };
  }

  private async key(name: "elevenlabs.apiKey" | "openai.apiKey", label: string): Promise<string> {
    const value = (await this.deps.secrets.get(name))?.trim();
    if (!value) {
      throw new ServiceError(
        409,
        "missing_api_key",
        `No ${label} API key is set. Add it in Settings > Voice.`,
      );
    }
    return value;
  }

  /** Fetch an upstream API; non-2xx becomes a 502 with the provider's message (never the key). */
  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (error) {
      if (init.signal?.aborted) throw new ServiceError(400, "aborted", "The request was cancelled");
      throw new ServiceError(
        502,
        "voice_unreachable",
        `Voice service unreachable: ${String(error)}`,
      );
    }
    if (res.ok) return res;
    const text = (await res.text().catch(() => "")).slice(0, 500);
    let detail = text;
    try {
      const parsed = JSON.parse(text) as {
        detail?: { message?: string } | string;
        error?: { message?: string };
      };
      detail =
        (typeof parsed.detail === "string" ? parsed.detail : parsed.detail?.message) ??
        parsed.error?.message ??
        text;
    } catch {
      // not JSON
    }
    const code = res.status === 401 || res.status === 403 ? "voice_auth" : "voice_upstream";
    throw new ServiceError(502, code, `Voice provider returned ${res.status}: ${detail}`);
  }
}
