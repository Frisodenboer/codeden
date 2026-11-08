import { LOCAL_STT_MAX_SECONDS, LOCAL_STT_SAMPLE_RATE } from "@codeden/contracts";
import { ServiceError } from "../../errors";

/** Mono 16-bit PCM samples at `LOCAL_STT_SAMPLE_RATE`, ready for Whisper. */
export interface Pcm16Audio {
  /** Little-endian 16-bit samples (its own buffer, exactly the sample bytes). */
  pcm: ArrayBuffer;
  durationSec: number;
}

/** Shortest clip worth transcribing. */
const MIN_SECONDS = 0.1;
const BYTES_PER_SECOND = LOCAL_STT_SAMPLE_RATE * 2;
const FORMAT_HELP = `The local engine takes WAV audio: 16-bit PCM, mono, ${LOCAL_STT_SAMPLE_RATE / 1000} kHz`;

const unsupported = (detail: string) =>
  new ServiceError(415, "unsupported_audio", `${FORMAT_HELP} (${detail}).`);

/**
 * Validate an uploaded WAV file for the local engine and return its samples. The browser
 * converts recordings to this format, so the server needs no audio decoder.
 */
export function parseWav(bytes: Uint8Array): Pcm16Audio {
  if (bytes.length === 0) throw new ServiceError(400, "empty_audio", "No audio was sent");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) =>
    at + 4 <= bytes.length ? String.fromCharCode(...bytes.subarray(at, at + 4)) : "";
  if (ascii(0) !== "RIFF" || ascii(8) !== "WAVE") throw unsupported("not a WAV file");

  let format: { tag: number; channels: number; rate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset);
    const declared = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      format = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) throw unsupported("the format chunk is missing");
      // 0xFFFE is WAVE_FORMAT_EXTENSIBLE, used by some writers for plain PCM.
      if (format.tag !== 1 && format.tag !== 0xfffe) throw unsupported("not PCM");
      if (format.bits !== 16) throw unsupported(`${format.bits}-bit samples`);
      if (format.channels !== 1) throw unsupported(`${format.channels} channels`);
      if (format.rate !== LOCAL_STT_SAMPLE_RATE) throw unsupported(`${format.rate} Hz`);
      // Streaming writers may leave the size open; take what is there, whole samples only.
      let length = Math.min(declared, bytes.length - body);
      length -= length % 2;
      const durationSec = length / BYTES_PER_SECOND;
      if (durationSec > LOCAL_STT_MAX_SECONDS) {
        throw new ServiceError(
          413,
          "audio_too_long",
          `Audio is longer than ${LOCAL_STT_MAX_SECONDS} seconds`,
        );
      }
      if (durationSec < MIN_SECONDS) {
        throw new ServiceError(400, "empty_audio", "The recording is too short to transcribe");
      }
      // Copy into a buffer of its own (a Node Buffer's `.buffer` may be a shared pool).
      const pcm = new Uint8Array(length);
      pcm.set(bytes.subarray(body, body + length));
      return { pcm: pcm.buffer, durationSec };
    }
    offset = body + declared + (declared % 2);
  }
  throw unsupported("no audio data");
}
