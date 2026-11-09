import type { Settings } from "@codeden/contracts";
import type { CodeDenClient } from "@/lib/api";
import { tts } from "./engines";
import { SpeechQueue } from "./speech-queue";

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
/** Resolves the promise of the `speak` call that owns the audio right now. */
let finish: (() => void) | null = null;

function stopAudio(): void {
  current?.pause();
  current = null;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
}

function settle(): void {
  const done = finish;
  finish = null;
  done?.();
}

/** Stop whatever is being read aloud right now (the queue moves on to its next item). */
export function cancelSpeech(): void {
  stopAudio();
  tts.cancel();
  settle();
}

/**
 * The global read-aloud queue (§11.3): finished turns from every session play one after
 * another instead of cutting each other off.
 */
export const speechQueue = new SpeechQueue({ stopAudio: cancelSpeech });

/**
 * Speak `text` now with the read-aloud engine from Settings (§11.3): the browser's
 * `speechSynthesis` by default, or ElevenLabs through the server's `/api/tts` proxy (the key
 * never reaches the browser). Replaces anything playing; resolves when playback ends or is
 * stopped. Finished turns go through `speechQueue` rather than calling this directly.
 * `voice` overrides the configured voice.
 */
export async function speak(
  client: CodeDenClient,
  settings: Settings,
  text: string,
  opts: { voice?: string | null } = {},
): Promise<void> {
  const ra = settings.voice.readAloud;
  const voice = opts.voice === undefined ? ra.voice : opts.voice;
  cancelSpeech();
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const mine = finish;
  const end = () => {
    if (finish === mine) settle();
  };
  if (ra.engine !== "elevenlabs") {
    tts.speak(text, { voice, onEnd: end });
    return done;
  }
  const audio = await client.voice.tts({ text: text.slice(0, 5_000), voiceId: voice ?? undefined });
  // Stopped (or replaced) while the audio was being fetched.
  if (finish !== mine) return;
  const url = URL.createObjectURL(audio);
  const el = new Audio(url);
  current = el;
  currentUrl = url;
  el.onended = el.onerror = () => {
    if (current === el) stopAudio();
    end();
  };
  try {
    await el.play();
  } catch (error) {
    if (current === el) stopAudio();
    end();
    throw error;
  }
  return done;
}
