import type { Settings } from "@codeden/contracts";
import type { CodeDenClient } from "@/lib/api";
import { tts } from "./engines";

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

function stopAudio(): void {
  current?.pause();
  current = null;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
}

/** Stop whatever is being read aloud. */
export function cancelSpeech(): void {
  stopAudio();
  tts.cancel();
}

/**
 * Speak `text` with the read-aloud engine from Settings (§11.3): the browser's
 * `speechSynthesis` by default, or ElevenLabs through the server's `/api/tts` proxy (the key
 * never reaches the browser). `voice` overrides the configured voice (the settings test).
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
  if (ra.engine !== "elevenlabs") {
    tts.speak(text, { voice });
    return;
  }
  const audio = await client.voice.tts({ text: text.slice(0, 5_000), voiceId: voice ?? undefined });
  const url = URL.createObjectURL(audio);
  const el = new Audio(url);
  current = el;
  currentUrl = url;
  el.onended = () => {
    if (current === el) stopAudio();
  };
  await el.play();
}
