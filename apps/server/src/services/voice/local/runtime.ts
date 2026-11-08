/**
 * The seam between CodeDen and the Whisper runtime (§11.3). The service only talks to these
 * interfaces, so tests inject a fake runtime and never load native code.
 */

export interface WhisperTranscription {
  text: string;
  /** Detected (or forced) language code, when the runtime reports one. */
  language: string | null;
}

/** A loaded model. One transcription runs at a time; the service queues them. */
export interface WhisperModel {
  /** `pcm`: mono 16-bit little-endian samples at 16 kHz. `language`: a code or `auto`. */
  transcribe(
    pcm: ArrayBuffer,
    opts: { language: string; signal?: AbortSignal },
  ): Promise<WhisperTranscription>;
  release(): Promise<void>;
}

export interface WhisperRuntime {
  loadModel(modelPath: string): Promise<WhisperModel>;
}

/** Load the runtime from the downloaded addon file. */
export type LoadWhisperRuntime = (addonPath: string) => Promise<WhisperRuntime>;

/** The parts of the whisper.cpp Node-API addon CodeDen uses. */
interface NativeContext {
  transcribeData(
    audio: ArrayBuffer,
    options: { language: string },
  ): {
    stop: () => Promise<void>;
    promise: Promise<{ result: string; language?: string; isAborted: boolean }>;
  };
  release(): Promise<void>;
}
type NativeContextCtor = new (options: { filePath: string; useGpu: boolean }) => NativeContext;

/** An addon is loaded once per process; loading the same file twice is not allowed. */
const loaded = new Map<string, NativeContextCtor>();

function loadAddon(addonPath: string): NativeContextCtor {
  const cached = loaded.get(addonPath);
  if (cached) return cached;
  const mod: { exports: { WhisperContext?: unknown } } = { exports: {} };
  process.dlopen(mod, addonPath);
  const ctor = mod.exports.WhisperContext;
  if (typeof ctor !== "function") throw new Error(`${addonPath} is not a Whisper runtime`);
  loaded.set(addonPath, ctor as NativeContextCtor);
  return ctor as NativeContextCtor;
}

/** The real runtime: whisper.cpp's Node-API addon, loaded in the server process. */
export const loadNativeRuntime: LoadWhisperRuntime = async (addonPath) => {
  const Context = loadAddon(addonPath);
  return {
    async loadModel(modelPath) {
      // Uses the GPU where the build has one (Metal on Apple silicon), else the CPU.
      const ctx = new Context({ filePath: modelPath, useGpu: true });
      return {
        async transcribe(pcm, { language, signal }) {
          const job = ctx.transcribeData(pcm, { language });
          const stop = () => void job.stop();
          signal?.addEventListener("abort", stop, { once: true });
          try {
            const result = await job.promise;
            if (result.isAborted) throw new Error("Transcription was cancelled");
            return { text: result.result, language: result.language || null };
          } finally {
            signal?.removeEventListener("abort", stop);
          }
        },
        release: () => ctx.release(),
      };
    },
  };
};
