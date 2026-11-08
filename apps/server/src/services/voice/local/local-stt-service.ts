import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { LocalSttStatus, SttResponse, WhisperModelId } from "@codeden/contracts";
import type { SettingsStore } from "../../../settings-store";
import { errorMessage, ServiceError } from "../../errors";
import {
  currentPlatform,
  MODEL_PINS,
  type ModelPin,
  RUNTIME_PINS,
  type RuntimePin,
  WHISPER_RUNTIME_VERSION,
} from "./catalog";
import { downloadVerified, partialPath } from "./download";
import { type LoadWhisperRuntime, loadNativeRuntime, type WhisperModel } from "./runtime";
import { extractTgzEntry } from "./tgz";
import { parseWav } from "./wav";

export interface LocalSttServiceDeps {
  /** `<home>/deps/whisper`: the runtime, one folder per version and platform. */
  runtimeDir: string;
  /** `<home>/models/whisper`: downloaded models. */
  modelsDir: string;
  settings: SettingsStore;
  /** Overridable for tests (a local fake server and tiny fixture files). */
  fetch?: typeof fetch;
  platform?: string;
  runtimePins?: Record<string, RuntimePin>;
  models?: ModelPin[];
  loadRuntime?: LoadWhisperRuntime;
  /** Unload the model after this long without use (default 10 minutes). */
  idleUnloadMs?: number;
  log?: (message: string) => void;
}

interface Job {
  received: number;
  abort: AbortController;
  promise: Promise<void>;
}

const RUNTIME = "runtime";

/** Strip Whisper's non-speech markers such as `[BLANK_AUDIO]` or `(silence)`. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\((?:silence|blank[ _]audio|music|inaudible|noise)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stop waiting for `promise` when `signal` aborts (the work itself carries on). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** `en-US` -> `en`. */
const isoLanguage = (language: string | null | undefined) =>
  language?.split("-")[0]?.toLowerCase() || null;

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/** Why the prebuilt runtime cannot load on this Linux (it needs glibc 2.34 or newer). */
function linuxProblem(): string | null {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } };
  const glibc = report?.header?.glibcVersionRuntime;
  if (!glibc) return "Local Whisper needs a glibc-based Linux (musl is not supported)";
  const [major = 0, minor = 0] = glibc.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 34)
    ? null
    : `Local Whisper needs glibc 2.34 or newer (this system has ${glibc})`;
}

/**
 * Local Whisper (§11.3): downloads the runtime and models into the CodeDen home on demand,
 * with progress, resume and checksum checks, and transcribes uploaded WAV audio in the
 * server process. Downloads run in the background; the UI polls `status()`.
 */
export class LocalSttService {
  private readonly platform: string;
  private readonly runtimePin: RuntimePin | undefined;
  private readonly models: ModelPin[];
  private readonly problem: string | null;
  private readonly jobs = new Map<string, Job>();
  private readonly errors = new Map<string, string>();
  private loaded: { id: WhisperModelId; model: WhisperModel } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: LocalSttServiceDeps) {
    this.platform = deps.platform ?? currentPlatform();
    this.runtimePin = (deps.runtimePins ?? RUNTIME_PINS)[this.platform];
    this.models = deps.models ?? MODEL_PINS;
    this.problem = !this.runtimePin
      ? `No prebuilt Whisper runtime for ${this.platform}`
      : !deps.platform && process.platform === "linux"
        ? linuxProblem()
        : null;
  }

  private get addonPath(): string {
    const version = this.runtimePin?.version ?? WHISPER_RUNTIME_VERSION;
    return join(this.deps.runtimeDir, `${version}-${this.platform}`, "whisper.node");
  }

  private modelPath(pin: ModelPin): string {
    return join(this.deps.modelsDir, pin.file);
  }

  private pin(id: WhisperModelId): ModelPin {
    const pin = this.models.find((m) => m.id === id);
    if (!pin) throw new ServiceError(404, "unknown_model", `Unknown Whisper model: ${id}`);
    return pin;
  }

  private runtimeInstalled(): boolean {
    return existsSync(this.addonPath);
  }

  private modelInstalled(pin: ModelPin): boolean {
    return fileSize(this.modelPath(pin)) === pin.bytes;
  }

  status(): LocalSttStatus {
    const entry = (key: string, total: number, installedPath: string | null, partial: string) => {
      const job = this.jobs.get(key);
      const sizeOnDisk = installedPath ? fileSize(installedPath) : null;
      const state = job
        ? "downloading"
        : sizeOnDisk !== null
          ? "installed"
          : this.errors.has(key)
            ? "failed"
            : "missing";
      return {
        state,
        // A stopped download keeps its partial file and resumes from there.
        receivedBytes: job?.received ?? (state === "installed" ? total : (fileSize(partial) ?? 0)),
        totalBytes: total,
        sizeOnDisk,
        error: state === "failed" ? (this.errors.get(key) ?? null) : null,
      } as const;
    };
    const runtime = this.runtimePin;
    return {
      supported: this.problem === null,
      platform: this.platform,
      unsupportedReason: this.problem,
      runtime: {
        version: runtime?.version ?? WHISPER_RUNTIME_VERSION,
        ...entry(
          RUNTIME,
          runtime?.bytes ?? 0,
          this.runtimeInstalled() ? this.addonPath : null,
          partialPath(this.archivePath()),
        ),
      },
      models: this.models.map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.hint,
        englishOnly: m.englishOnly,
        recommended: m.recommended,
        ...entry(
          m.id,
          m.bytes,
          this.modelInstalled(m) ? this.modelPath(m) : null,
          partialPath(this.modelPath(m)),
        ),
      })),
      location: this.deps.modelsDir,
    };
  }

  /** Start (or join) downloading the runtime and a model; returns right away. */
  download(id: WhisperModelId): LocalSttStatus {
    if (this.problem) throw new ServiceError(409, "unsupported_platform", this.problem);
    const pin = this.pin(id);
    if (!this.jobs.has(id) && !(this.runtimeInstalled() && this.modelInstalled(pin))) {
      this.track(id, async (signal, progress) => {
        await abortable(this.ensureRuntime(), signal);
        if (this.modelInstalled(pin)) return;
        await downloadVerified({
          file: pin,
          dest: this.modelPath(pin),
          fetch: this.deps.fetch,
          signal,
          onProgress: progress,
        });
        this.deps.log?.(`Whisper model ${pin.id} downloaded`);
      }).catch(() => {});
    }
    return this.status();
  }

  /** Cancel a running download or delete a downloaded model (and its partial file). */
  async remove(id: WhisperModelId): Promise<LocalSttStatus> {
    const pin = this.pin(id);
    const job = this.jobs.get(id);
    if (job) {
      job.abort.abort();
      await job.promise.catch(() => {});
    }
    // Wait for a transcription that is using the model before freeing it.
    if (this.loaded?.id === id) await this.serially(() => this.unload());
    rmSync(this.modelPath(pin), { force: true });
    rmSync(partialPath(this.modelPath(pin)), { force: true });
    this.errors.delete(id);
    return this.status();
  }

  /** Transcribe a WAV upload with the model chosen in Settings. */
  async transcribe(
    audio: Uint8Array,
    opts: { language?: string | null; signal?: AbortSignal } = {},
  ): Promise<SttResponse> {
    if (this.problem) throw new ServiceError(409, "unsupported_platform", this.problem);
    const { pcm } = parseWav(audio);
    const pin = this.pin(this.deps.settings.get().voice.dictation.local.model);
    if (!this.runtimeInstalled() || !this.modelInstalled(pin)) {
      throw new ServiceError(
        409,
        "model_not_installed",
        `The ${pin.label} Whisper model isn't downloaded yet. Download it in Settings > Voice.`,
      );
    }
    const language = pin.englishOnly ? "en" : (isoLanguage(opts.language) ?? "auto");
    return this.serially(async () => {
      const model = await this.model(pin);
      const started = performance.now();
      try {
        const result = await model.transcribe(pcm, { language, signal: opts.signal });
        return {
          text: cleanTranscript(result.text),
          language: result.language ?? (language === "auto" ? null : language),
          engine: "local" as const,
          elapsedMs: Math.round(performance.now() - started),
        };
      } catch (error) {
        if (opts.signal?.aborted) throw new ServiceError(400, "aborted", "Cancelled");
        throw new ServiceError(500, "transcription_failed", errorMessage(error));
      } finally {
        this.armIdleUnload();
      }
    });
  }

  /** Resolves when no download is running (tests). */
  async settled(): Promise<void> {
    while (this.jobs.size > 0) {
      await Promise.allSettled([...this.jobs.values()].map((j) => j.promise));
    }
  }

  /** Cancel downloads and free the model (server shutdown). */
  async stop(): Promise<void> {
    for (const job of this.jobs.values()) job.abort.abort();
    await this.settled();
    await this.unload();
  }

  private archivePath(): string {
    const name = this.runtimePin?.url.split("/").pop() ?? "runtime.tgz";
    return join(this.deps.runtimeDir, ".downloads", name);
  }

  private ensureRuntime(): Promise<void> {
    const pin = this.runtimePin;
    if (!pin) return Promise.reject(new Error(this.problem ?? "No runtime"));
    if (this.runtimeInstalled()) return Promise.resolve();
    return this.track(RUNTIME, async (signal, progress) => {
      const archive = this.archivePath();
      await downloadVerified({
        file: pin,
        dest: archive,
        fetch: this.deps.fetch,
        signal,
        onProgress: progress,
      });
      const addon = extractTgzEntry(readFileSync(archive), pin.entry);
      mkdirSync(join(this.addonPath, ".."), { recursive: true });
      const staging = `${this.addonPath}.tmp`;
      writeFileSync(staging, addon, { mode: 0o755 });
      renameSync(staging, this.addonPath);
      rmSync(archive, { force: true });
      this.deps.log?.(`Whisper runtime ${pin.version} installed for ${this.platform}`);
    });
  }

  /** Run one download at a time per key; callers join a running one. */
  private track(
    key: string,
    work: (signal: AbortSignal, progress: (received: number) => void) => Promise<void>,
  ): Promise<void> {
    const running = this.jobs.get(key);
    if (running) return running.promise;
    const abort = new AbortController();
    const job: Job = { received: 0, abort, promise: Promise.resolve() };
    this.errors.delete(key);
    job.promise = work(abort.signal, (received) => {
      job.received = received;
    })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          this.errors.set(key, errorMessage(error));
          this.deps.log?.(`Whisper download (${key}) failed: ${errorMessage(error)}`);
        }
        throw error;
      })
      .finally(() => this.jobs.delete(key));
    this.jobs.set(key, job);
    return job.promise;
  }

  private serially<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private async model(pin: ModelPin): Promise<WhisperModel> {
    clearTimeout(this.idleTimer);
    if (this.loaded?.id === pin.id) return this.loaded.model;
    await this.unload();
    const runtime = await (this.deps.loadRuntime ?? loadNativeRuntime)(this.addonPath);
    const model = await runtime.loadModel(this.modelPath(pin));
    this.loaded = { id: pin.id, model };
    return model;
  }

  private armIdleUnload(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => void this.serially(() => this.unload()),
      this.deps.idleUnloadMs ?? 10 * 60_000,
    );
    this.idleTimer.unref();
  }

  private async unload(): Promise<void> {
    clearTimeout(this.idleTimer);
    const current = this.loaded;
    this.loaded = null;
    await current?.model.release().catch(() => {});
  }
}
