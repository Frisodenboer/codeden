import { LOCAL_STT_MAX_SECONDS, LOCAL_STT_SAMPLE_RATE } from "@codeden/contracts";

/**
 * Turns a browser recording into what the local Whisper engine takes (§11.3): WAV, 16-bit
 * PCM, mono, 16 kHz. Doing it here keeps an audio decoder (ffmpeg) off the server.
 */

/** Average the channels into one. */
export function downmix(channels: Float32Array[]): Float32Array {
  const [first] = channels;
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first.slice();
  const out = new Float32Array(first.length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (channel[i] ?? 0);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / channels.length;
  return out;
}

/**
 * Change the sample rate. Downsampling averages the input samples each output sample covers
 * (a simple low-pass, so 48 kHz speech does not alias); upsampling interpolates linearly.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j] ?? 0;
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < length; i++) {
      const at = i * ratio;
      const left = Math.floor(at);
      const right = Math.min(input.length - 1, left + 1);
      const t = at - left;
      out[i] = (input[left] ?? 0) * (1 - t) + (input[right] ?? 0) * t;
    }
  }
  return out;
}

/** Encode mono samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Decoded audio, as `AudioBuffer` provides it. */
export interface DecodedAudio {
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** Mono 16 kHz WAV from decoded audio, cut to the local engine's longest clip. */
export function decodedToWhisperWav(audio: DecodedAudio): Blob {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
    audio.getChannelData(i),
  );
  const mono = resample(downmix(channels), audio.sampleRate, LOCAL_STT_SAMPLE_RATE);
  const samples = mono.subarray(0, LOCAL_STT_MAX_SECONDS * LOCAL_STT_SAMPLE_RATE);
  return new Blob([encodeWav16(samples, LOCAL_STT_SAMPLE_RATE)], { type: "audio/wav" });
}

/** Decode a `MediaRecorder` clip (WebM, Ogg or MP4) and convert it for local Whisper. */
export async function toWhisperWav(recording: Blob): Promise<Blob> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This browser can't decode audio for local Whisper.");
  const context = new Ctx();
  try {
    return decodedToWhisperWav(await context.decodeAudioData(await recording.arrayBuffer()));
  } finally {
    void context.close();
  }
}
