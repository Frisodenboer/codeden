import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_STT_UNAVAILABLE,
  browserSttAvailability,
  createBrowserStt,
  resetBrowserSttAvailability,
} from "@/lib/voice/engines";
import { decodedToWhisperWav, downmix, encodeWav16, resample } from "@/lib/voice/wav";

describe("WAV conversion for local Whisper", () => {
  it("downmixes channels by averaging", () => {
    const out = downmix([new Float32Array([1, 0.5, -1]), new Float32Array([0, 0.5, 1])]);
    expect([...out]).toEqual([0.5, 0.5, 0]);
    expect(downmix([])).toHaveLength(0);
    const mono = new Float32Array([0.25]);
    expect(downmix([mono])).not.toBe(mono);
  });

  it("downsamples 48 kHz to 16 kHz by averaging each window", () => {
    const input = Float32Array.from({ length: 48 }, (_, i) => Math.floor(i / 3));
    const out = resample(input, 48_000, 16_000);
    expect(out).toHaveLength(16);
    expect([...out]).toEqual(Array.from({ length: 16 }, (_, i) => i));
    // 44.1 kHz does not divide evenly; the length still follows the duration.
    expect(resample(new Float32Array(44_100), 44_100, 16_000)).toHaveLength(16_000);
  });

  it("upsamples by linear interpolation", () => {
    const out = resample(new Float32Array([0, 1, 0, -1]), 8_000, 16_000);
    expect([...out]).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
  });

  it("encodes 16-bit mono PCM WAV with clamping", () => {
    const wav = encodeWav16(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16_000);
    const view = new DataView(wav);
    const text = (at: number) => String.fromCharCode(...new Uint8Array(wav.slice(at, at + 4)));
    expect(wav.byteLength).toBe(44 + 12);
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(36 + 12);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });

  it("turns decoded stereo 48 kHz audio into 16 kHz mono, cut to two minutes", async () => {
    const seconds = 125;
    const left = new Float32Array(48_000 * seconds).fill(0.5);
    const right = new Float32Array(48_000 * seconds).fill(-0.5);
    const blob = decodedToWhisperWav({
      sampleRate: 48_000,
      numberOfChannels: 2,
      getChannelData: (i) => (i === 0 ? left : right),
    });
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 120 * 16_000 * 2);
    const view = new DataView(await blob.slice(0, 48).arrayBuffer());
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(0);
  });
});

describe("browser speech recognition availability", () => {
  const w = window as unknown as { webkitSpeechRecognition?: unknown };
  afterEach(() => {
    delete w.webkitSpeechRecognition;
    resetBrowserSttAvailability();
  });

  it("is detected by capability and remembers a missing speech service", () => {
    expect(browserSttAvailability()).toBe("unsupported");
    const started: Array<{ onerror: ((e: { error: string }) => void) | null }> = [];
    w.webkitSpeechRecognition = class {
      onerror: ((e: { error: string }) => void) | null = null;
      onresult = null;
      onend = null;
      start() {
        started.push(this);
      }
      stop() {}
    };
    expect(browserSttAvailability()).toBe("available");
    const stt = createBrowserStt();
    expect(stt.supported).toBe(true);
    const onError = vi.fn();
    stt.start({ onText: () => {}, onEnd: () => {}, onError });
    started[0]?.onerror?.({ error: "network" });
    expect(onError).toHaveBeenCalledWith(BROWSER_STT_UNAVAILABLE);
    expect(browserSttAvailability()).toBe("failed");
    expect(stt.supported).toBe(false);
    resetBrowserSttAvailability();
    expect(stt.supported).toBe(true);
  });
});
