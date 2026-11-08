import { describe, expect, it } from "vitest";
import {
  LocalSttModelParams,
  LocalSttStatus,
  Settings,
  SttQuery,
  SttResponse,
  TtsRequest,
  VoiceListResponse,
} from "../src";

describe("voice contracts", () => {
  it("round-trips and validates the cloud voice shapes", () => {
    expect(TtsRequest.parse({ text: "Done.", outputFormat: "mp3_44100_64" })).toEqual({
      text: "Done.",
      outputFormat: "mp3_44100_64",
    });
    expect(TtsRequest.safeParse({ text: "" }).success).toBe(false);
    expect(TtsRequest.safeParse({ text: "x".repeat(5_001) }).success).toBe(false);
    const voices = { voices: [{ id: "v1", name: "Ada", labels: { accent: "british" } }] };
    expect(VoiceListResponse.parse(voices)).toEqual(voices);
    expect(SttQuery.parse({ engine: "openai", language: "en" })).toEqual({
      engine: "openai",
      language: "en",
    });
    expect(SttResponse.parse({ text: "hi", language: null, engine: "elevenlabs" }).engine).toBe(
      "elevenlabs",
    );
  });

  it("accepts the local engine for transcription with its timing", () => {
    expect(SttQuery.parse({ engine: "local" })).toEqual({ engine: "local" });
    expect(SttQuery.safeParse({ engine: "browser" }).success).toBe(false);
    const res = { text: "run the tests", language: "en", engine: "local", elapsedMs: 412.5 };
    expect(SttResponse.parse(res)).toEqual(res);
    expect(SttResponse.safeParse({ ...res, elapsedMs: -1 }).success).toBe(false);
  });

  it("round-trips the local Whisper status", () => {
    const download = { receivedBytes: 0, totalBytes: 1_205_460, sizeOnDisk: null, error: null };
    const status = {
      supported: true,
      platform: "win32-x64",
      unsupportedReason: null,
      runtime: { version: "1.1.3", state: "installed", ...download, sizeOnDisk: 2_756_608 },
      models: [
        {
          id: "base.en",
          label: "Base (English)",
          hint: "Fast, good accuracy",
          englishOnly: true,
          recommended: true,
          state: "downloading",
          ...download,
          receivedBytes: 1_000,
          totalBytes: 59_721_011,
        },
        {
          id: "small",
          label: "Small",
          hint: "Slower, best accuracy",
          englishOnly: false,
          recommended: false,
          state: "failed",
          ...download,
          error: "Checksum mismatch",
        },
      ],
      location: "/home/me/.codeden/models/whisper",
    };
    expect(LocalSttStatus.parse(status)).toEqual(status);
    expect(LocalSttStatus.safeParse({ ...status, models: [{ id: "large" }] }).success).toBe(false);
    expect(LocalSttModelParams.parse({ id: "tiny.en" })).toEqual({ id: "tiny.en" });
    expect(LocalSttModelParams.safeParse({ id: "large-v3" }).success).toBe(false);
  });

  it("defaults dictation to the browser with base.en for local Whisper", () => {
    const s = Settings.parse({});
    expect(s.voice.dictation.engine).toBe("browser");
    expect(s.voice.dictation.local).toEqual({ model: "base.en" });
    const local = Settings.parse({
      voice: { dictation: { engine: "local", local: { model: "small" } } },
    });
    expect(local.voice.dictation).toMatchObject({ engine: "local", local: { model: "small" } });
    expect(Settings.parse(JSON.parse(JSON.stringify(local)))).toEqual(local);
    expect(Settings.safeParse({ voice: { dictation: { engine: "whisper" } } }).success).toBe(false);
  });
});
