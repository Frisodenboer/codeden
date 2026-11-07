/**
 * Image generation engines (§12.5). Every engine sits behind `ImageEngine`, so the
 * `generate_image` tool, the Settings "test" button and the registry never branch on an id.
 */

/** Built-in engine ids; matches `settings.imageGeneration.engine` minus `auto`/`none`. */
export type ImageEngineId = "codex" | "gemini" | "openai";

/** Aspect ratios accepted by `generate()`. Engines map them to what their API supports. */
export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export type ImageQuality = "auto" | "low" | "medium" | "high";

/** Most images one `generate()` call may produce. */
export const MAX_IMAGE_COUNT = 4;

export interface ImageGenerateRequest {
  prompt: string;
  /** Preferred shape. Ignored when `size` already implies one. */
  aspectRatio?: ImageAspectRatio;
  /** `WIDTHxHEIGHT` (e.g. `1024x1024`) or a resolution class (`1K`, `2K`, `4K`). */
  size?: string;
  quality?: ImageQuality;
  /** 1..MAX_IMAGE_COUNT, default 1. */
  count?: number;
  /** Absolute paths of existing images used for edits and variations. */
  referenceImages?: string[];
  /** Absolute directory the files are written to (created if missing). */
  outputDir: string;
  /** File name without extension; default `image`. Extra images get `-2`, `-3`, ... */
  fileStem?: string;
  /** Overall deadline; each engine has its own default. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ImageGenerateResult {
  /** Absolute paths of the written files, in generation order. */
  files: string[];
  engine: ImageEngineId;
  /** The model that produced the images (`""` when the engine cannot tell). */
  model: string;
  /** The prompt the model actually used, when the engine rewrites prompts. */
  revisedPrompt?: string;
}

export interface ImageEngineAvailability {
  available: boolean;
  /** Why the engine is unavailable (or a note when available, e.g. the login method). */
  reason?: string;
}

/** What an engine can do; read by the tool layer instead of branching on ids. */
export interface ImageEngineCapabilities {
  referenceImages: boolean;
  /** `size` is honoured exactly rather than mapped to the nearest supported shape. */
  exactSize: boolean;
  /** Needs an API key (stored in the OS keychain). */
  requiresApiKey: boolean;
}

export interface ImageEngine {
  readonly id: ImageEngineId;
  /** Human label for Settings. */
  readonly label: string;
  readonly capabilities: ImageEngineCapabilities;
  /** Default model id used when the engine was not configured with one. */
  readonly defaultModel: string;
  /** Never throws. */
  detect(): Promise<ImageEngineAvailability>;
  /** Throws `ImageGenerationError`. */
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResult>;
}
