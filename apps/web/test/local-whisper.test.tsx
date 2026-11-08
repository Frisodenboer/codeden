import type { LocalSttStatus } from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { modelStatusText } from "@/components/settings/local-whisper";
import { WhisperTest } from "@/components/settings/local-whisper-test";
import { LocalWhisperRows } from "@/components/settings/sections-voice-local";
import { createMockClient } from "@/lib/api/mock";
import { createCloudStt } from "@/lib/voice/cloud-stt";
import { renderWithClient } from "./utils";

// No microphone or audio decoder in jsdom: the clip and its WAV conversion are stand-ins.
vi.mock("@/lib/voice/recorder", () => ({
  canRecord: () => true,
  recordClip: vi.fn(async () => new Blob(["webm"], { type: "audio/webm" })),
  startRecording: vi.fn(async () => {
    let finish: (clip: Blob) => void = () => {};
    const stopped = new Promise<Blob>((resolve) => {
      finish = resolve;
    });
    return {
      stopped,
      stop: () => {
        finish(new Blob(["webm"], { type: "audio/webm" }));
        return stopped;
      },
    };
  }),
}));
vi.mock("@/lib/voice/wav", () => ({
  toWhisperWav: vi.fn(async () => new Blob(["RIFF"], { type: "audio/wav" })),
}));

const status = (over: Partial<LocalSttStatus["models"][number]> = {}): LocalSttStatus => ({
  supported: true,
  platform: "linux-x64",
  unsupportedReason: null,
  runtime: {
    version: "1.1.3",
    state: "missing",
    receivedBytes: 0,
    totalBytes: 1_279_405,
    sizeOnDisk: null,
    error: null,
  },
  models: [
    {
      id: "base.en",
      label: "Base (English)",
      hint: "Fast, good accuracy",
      englishOnly: true,
      recommended: true,
      state: "missing",
      receivedBytes: 0,
      totalBytes: 59_721_011,
      sizeOnDisk: null,
      error: null,
      ...over,
    },
  ],
  location: "/home/me/.codeden/models/whisper",
});

describe("local Whisper settings", () => {
  it("describes each download state", () => {
    const missing = status();
    expect(modelStatusText(missing, missing.models[0] as never)).toBe(
      "Not downloaded · 58.2 MB download",
    );
    const partial = status({ receivedBytes: 29_860_506 });
    expect(modelStatusText(partial, partial.models[0] as never)).toMatch(/\(50% done\)$/);
    const downloading = status({ state: "downloading", receivedBytes: 29_860_506 });
    expect(modelStatusText(downloading, downloading.models[0] as never)).toBe(
      "Downloading 50% of 57.0 MB",
    );
    const runtimeFirst: LocalSttStatus = {
      ...downloading,
      runtime: { ...downloading.runtime, state: "downloading", receivedBytes: 639_702 },
    };
    expect(modelStatusText(runtimeFirst, runtimeFirst.models[0] as never)).toBe(
      "Downloading the Whisper runtime… 49%",
    );
    const installed: LocalSttStatus = {
      ...status({ state: "installed", sizeOnDisk: 59_721_011 }),
      runtime: { ...missing.runtime, state: "installed", sizeOnDisk: 2_906_024 },
    };
    expect(modelStatusText(installed, installed.models[0] as never)).toBe(
      "Installed · 59.7 MB on disk",
    );
    const failed = status({ state: "failed", error: "Checksum mismatch" });
    expect(modelStatusText(failed, failed.models[0] as never)).toBe("Checksum mismatch");
    const unsupported = { ...missing, supported: false, unsupportedReason: "No runtime here" };
    expect(modelStatusText(unsupported, missing.models[0] as never)).toBe("No runtime here");
  });

  it("downloads the chosen model and can cancel it", async () => {
    const client = createMockClient();
    renderWithClient(<LocalWhisperRows />, client);
    expect(await screen.findByText(/Not downloaded · 58.1 MB download/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Test/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    expect(await screen.findByRole("button", { name: /Cancel/ })).toBeTruthy();
    expect(screen.getByTestId("whisper-model-status").textContent).toMatch(/Downloading/);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(await screen.findByRole("button", { name: /Download/ })).toBeTruthy();
  });

  it("records a clip, transcribes it locally and shows the timing", async () => {
    const client = createMockClient();
    const stt = vi.spyOn(client.voice, "stt");
    renderWithClient(<WhisperTest language="en-GB" />, client);
    fireEvent.click(screen.getByRole("button", { name: /Test/ }));
    expect(await screen.findByText("“Run the checkout tests again”")).toBeTruthy();
    expect(screen.getByText(/Transcribed in 0.64 s · .* round trip/)).toBeTruthy();
    await waitFor(() => expect(stt).toHaveBeenCalledTimes(1));
    const [audio, query] = stt.mock.calls[0] ?? [];
    expect((audio as Blob).type).toBe("audio/wav");
    expect(query).toEqual({ engine: "local", language: "en" });
  });

  it("dictates through local Whisper: records, converts to WAV, transcribes once", async () => {
    const client = createMockClient();
    const stt = vi.spyOn(client.voice, "stt");
    const engine = createCloudStt(client, "local");
    expect(engine.supported).toBe(true);
    const onText = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    // Stopping right away (before the microphone is ready) still ends the recording.
    engine.start({ language: "en-US", onText, onEnd, onError });
    engine.stop();
    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
    expect(onText).toHaveBeenCalledWith("Run the checkout tests again", true);
    const [audio, query] = stt.mock.calls[0] ?? [];
    expect((audio as Blob).type).toBe("audio/wav");
    expect(query).toEqual({ engine: "local", language: "en" });
  });

  it("shows why a test failed", async () => {
    const client = createMockClient();
    vi.spyOn(client.voice, "stt").mockRejectedValueOnce(
      new Error("The Base (English) Whisper model isn't downloaded yet."),
    );
    renderWithClient(<WhisperTest language={null} />, client);
    fireEvent.click(screen.getByRole("button", { name: /Test/ }));
    expect(await screen.findByText(/isn't downloaded yet/)).toBeTruthy();
  });
});
