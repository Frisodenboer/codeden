/**
 * Voice engines (§11.3) sit behind small interfaces so cloud or local engines can be swapped in.
 * The browser implementations are the defaults.
 */

export interface SpeechToText {
  readonly supported: boolean;
  /** Start listening. `onText` receives the running transcript (interim + final). */
  start(opts: {
    language?: string | null;
    onText: (text: string, final: boolean) => void;
    onEnd: () => void;
    onError: (message: string) => void;
  }): void;
  stop(): void;
}

export interface TextToSpeech {
  readonly supported: boolean;
  speak(text: string, opts?: { voice?: string | null; rate?: number }): void;
  cancel(): void;
  voices(): { id: string; label: string; lang: string }[];
}

interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const UNAVAILABLE_KEY = "codeden.voice.browserSttUnavailable";
/**
 * Recognition errors that mean the speech service itself is missing here (some browsers and
 * embedded runtimes ship the API without a service behind it), not a one-off problem.
 */
const SERVICE_ERRORS = new Set(["network", "service-not-allowed"]);

/**
 * Whether browser speech recognition works here, by capability: `unsupported` when the API
 * is missing, `failed` once its service has failed (remembered per browser), else
 * `available`.
 */
export function browserSttAvailability(): "available" | "unsupported" | "failed" {
  if (!recognitionCtor()) return "unsupported";
  try {
    if (window.localStorage.getItem(UNAVAILABLE_KEY) === "1") return "failed";
  } catch {
    // storage blocked: assume it works
  }
  return "available";
}

/** Forget a remembered failure (the user picked the browser engine again). */
export function resetBrowserSttAvailability(): void {
  try {
    window.localStorage.removeItem(UNAVAILABLE_KEY);
  } catch {
    // storage blocked
  }
}

function markBrowserSttFailed(): void {
  try {
    window.localStorage.setItem(UNAVAILABLE_KEY, "1");
  } catch {
    // storage blocked
  }
}

export const BROWSER_STT_UNAVAILABLE =
  "Browser speech recognition isn't available here. Choose Local (Whisper) in Settings > Voice.";

export function createBrowserStt(): SpeechToText {
  const Ctor = recognitionCtor();
  let rec: Recognition | null = null;
  return {
    get supported() {
      return browserSttAvailability() === "available";
    },
    start({ language, onText, onEnd, onError }) {
      if (!Ctor) {
        onError(BROWSER_STT_UNAVAILABLE);
        return;
      }
      rec = new Ctor();
      rec.lang = language ?? navigator.language;
      rec.continuous = true;
      rec.interimResults = true;
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r) continue;
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        onText((finalText + interim).trim(), interim === "");
      };
      rec.onerror = (e) => {
        if (SERVICE_ERRORS.has(e.error)) {
          markBrowserSttFailed();
          onError(BROWSER_STT_UNAVAILABLE);
          return;
        }
        onError(e.error === "not-allowed" ? "Microphone access was blocked." : e.error);
      };
      rec.onend = () => {
        rec = null;
        onEnd();
      };
      rec.start();
    },
    stop() {
      rec?.stop();
    },
  };
}

export function createBrowserTts(): TextToSpeech {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  return {
    supported: Boolean(synth),
    speak(text, opts) {
      if (!synth || !text) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = synth.getVoices().find((v) => v.voiceURI === opts?.voice);
      if (voice) u.voice = voice;
      u.rate = opts?.rate ?? 1.05;
      synth.speak(u);
    },
    cancel() {
      synth?.cancel();
    },
    voices() {
      return (synth?.getVoices() ?? []).map((v) => ({
        id: v.voiceURI,
        label: v.name,
        lang: v.lang,
      }));
    },
  };
}

export const stt: SpeechToText = createBrowserStt();
export const tts: TextToSpeech = createBrowserTts();
