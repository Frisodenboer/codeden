import { ImageGenerationError, toImageError } from "./errors";
import { type ApiKeySource, type FetchLike, postJson, readApiKey } from "./http";
import { writeImages } from "./image-file";
import {
  deadline,
  normalizeRequest,
  orientationOf,
  parseSize,
  type ReferenceImage,
  readReferenceImages,
  requestedRatio,
} from "./request";
import type {
  ImageEngine,
  ImageEngineAvailability,
  ImageGenerateRequest,
  ImageGenerateResult,
} from "./types";

/** Current GPT Image model (the Images API default). */
export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_API_BASE = "https://api.openai.com/v1";
const STANDARD_SIZES = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" };

export interface OpenAIImageEngineOptions {
  /** OpenAI API key, or a reader for it (OS keychain). */
  apiKey?: ApiKeySource;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Default 180s. */
  timeoutMs?: number;
}

interface OpenAIImagesResponse {
  data?: { b64_json?: string; revised_prompt?: string }[];
}

/**
 * The Images API `size` for a request. `gpt-image-2` and newer accept any `WxH` with both
 * edges divisible by 16, a ratio between 1:3 and 3:1 and at most 3840 px; everything else is
 * mapped to the nearest standard size. `undefined` lets the API choose.
 */
export function openAiSize(
  request: Pick<ImageGenerateRequest, "size" | "aspectRatio">,
  model: string,
): string | undefined {
  const size = request.size ? parseSize(request.size) : undefined;
  if (size?.kind === "pixels" && /^gpt-image-[2-9]/.test(model)) {
    const { width, height } = size;
    const ratio = width / height;
    if (
      width % 16 === 0 &&
      height % 16 === 0 &&
      ratio >= 1 / 3 &&
      ratio <= 3 &&
      Math.max(width, height) <= 3840
    ) {
      return `${width}x${height}`;
    }
  }
  const orientation = orientationOf(requestedRatio(request));
  return orientation ? STANDARD_SIZES[orientation] : undefined;
}

/** JSON body for `/images/generations` or (with references) `/images/edits`. Pure. */
export function buildOpenAIRequest(
  request: Pick<ImageGenerateRequest, "prompt" | "size" | "aspectRatio" | "quality"> & {
    count: number;
  },
  model: string,
  references: readonly Pick<ReferenceImage, "mimeType" | "data">[],
): { path: "/images/generations" | "/images/edits"; body: Record<string, unknown> } {
  const size = openAiSize(request, model);
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    n: request.count,
    output_format: "png",
    ...(size ? { size } : {}),
    ...(request.quality && request.quality !== "auto" ? { quality: request.quality } : {}),
  };
  if (!references.length) return { path: "/images/generations", body };
  body.images = references.map((r) => ({
    image_url: `data:${r.mimeType};base64,${r.data.toString("base64")}`,
  }));
  return { path: "/images/edits", body };
}

/** OpenAI Images API (`gpt-image-*`) with an API key. */
export class OpenAIImageEngine implements ImageEngine {
  readonly id = "openai" as const;
  readonly label = "OpenAI Images";
  readonly capabilities = { referenceImages: true, exactSize: true, requiresApiKey: true };
  readonly defaultModel = OPENAI_IMAGE_MODEL;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: OpenAIImageEngineOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  get model(): string {
    return this.opts.model ?? OPENAI_IMAGE_MODEL;
  }

  async detect(): Promise<ImageEngineAvailability> {
    try {
      return (await readApiKey(this.opts.apiKey))
        ? { available: true }
        : { available: false, reason: "No OpenAI API key is configured." };
    } catch (error) {
      return { available: false, reason: `Could not read the API key: ${String(error)}` };
    }
  }

  async generate(input: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const request = normalizeRequest(this.id, input);
    const { signal, dispose } = deadline(
      this.id,
      request.timeoutMs ?? this.opts.timeoutMs ?? 180_000,
      request.signal,
    );
    try {
      const key = await readApiKey(this.opts.apiKey);
      if (!key)
        throw new ImageGenerationError("unavailable", this.id, "No OpenAI API key is configured");
      const references = await readReferenceImages(this.id, request.referenceImages);
      const { path, body } = buildOpenAIRequest(request, this.model, references);
      const base = (this.opts.baseUrl ?? OPENAI_API_BASE).replace(/\/$/, "");
      const reply = await postJson<OpenAIImagesResponse>(
        this.id,
        this.fetchImpl,
        `${base}${path}`,
        { authorization: `Bearer ${key}` },
        body,
        signal,
      );
      const data = (reply.data ?? []).filter((d) => d.b64_json);
      if (!data.length)
        throw new ImageGenerationError("no_image", this.id, "OpenAI returned no image");
      const images = data.map((d) => Buffer.from(d.b64_json ?? "", "base64"));
      const files = await writeImages(this.id, images, request.outputDir, request.fileStem);
      const revisedPrompt = data.find((d) => d.revised_prompt)?.revised_prompt;
      return {
        files,
        engine: this.id,
        model: this.model,
        ...(revisedPrompt ? { revisedPrompt } : {}),
      };
    } catch (error) {
      throw toImageError(error, this.id, signal);
    } finally {
      dispose();
    }
  }
}
