import { describe, expect, it } from "vitest";
import { SttQuery, SttResponse, TtsRequest, VoiceListResponse } from "../src";

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
});
