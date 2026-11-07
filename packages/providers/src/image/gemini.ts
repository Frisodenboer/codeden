import { ImageGenerationError, toImageError } from "./errors";
import { type ApiKeySource, type FetchLike, postJson, readApiKey } from "./http";
import { writeImages } from "./image-file";
import {
  deadline,
  nearestAspectRatio,
  normalizeRequest,
  parseSize,
  type ReferenceImage,
  readReferenceImages,
} from "./request";
import type {
  ImageEngine,
  ImageEngineAvailability,
  ImageGenerateRequest,
  ImageGenerateResult,
} from "./types";

/** Current Gemini image model ("Nano Banana" family). */
export const GEMINI_IMAGE_MODEL = "gemini-nano-banana-2.1";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1";
const GEMINI_ASPECT_RATIOS = [
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

export interface GeminiImageEngineOptions {
  /** Google AI API key, or a reader for it (OS keychain). */
  apiKey?: ApiKeySource;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Default 120s. */
  timeoutMs?: number;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** The `generateContent` body for one image. Pure; exported for tests. */
export function buildGeminiRequest(
  request: Pick<ImageGenerateRequest, "prompt" | "aspectRatio" | "size">,
  references: readonly Pick<ReferenceImage, "mimeType" | "data">[],
): Record<string, unknown> {
  const imageConfig: Record<string, string> = {};
  const size = request.size ? parseSize(request.size) : undefined;
  if (size?.kind === "pixels") {
    imageConfig.aspectRatio = nearestAspectRatio(size.width / size.height, GEMINI_ASPECT_RATIOS);
    const edge = Math.max(size.width, size.height);
    imageConfig.imageSize = edge <= 1024 ? "1K" : edge <= 2048 ? "2K" : "4K";
  } else if (size?.kind === "class") {
    imageConfig.imageSize = size.value;
  }
  if (request.aspectRatio && !imageConfig.aspectRatio)
    imageConfig.aspectRatio = request.aspectRatio;
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: request.prompt },
          ...references.map((r) => ({
            inlineData: { mimeType: r.mimeType, data: r.data.toString("base64") },
          })),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  };
}

/** Final (non-thought) images from a reply. Throws `content_policy` / `no_image`. */
export function parseGeminiImages(response: GeminiResponse): Buffer[] {
  const block = response.promptFeedback?.blockReason;
  if (block) {
    throw new ImageGenerationError(
      "content_policy",
      "gemini",
      `Gemini blocked the prompt (${block})`,
    );
  }
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const images = parts
    .filter((p) => !p.thought && p.inlineData?.data && p.inlineData.mimeType?.startsWith("image/"))
    .map((p) => Buffer.from(p.inlineData?.data ?? "", "base64"));
  if (images.length) return images;
  const reason = candidate?.finishReason;
  if (reason && /SAFETY|PROHIBITED|BLOCKLIST|IMAGE_SAFETY|RECITATION/.test(reason)) {
    throw new ImageGenerationError(
      "content_policy",
      "gemini",
      `Gemini refused the image (${reason})`,
    );
  }
  const text = parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join(" ")
    .trim();
  throw new ImageGenerationError(
    "no_image",
    "gemini",
    `Gemini returned no image${text ? `: ${text.slice(0, 300)}` : reason ? ` (${reason})` : ""}`,
  );
}

/** Gemini image models over the REST API with an API key. One request per image. */
export class GeminiImageEngine implements ImageEngine {
  readonly id = "gemini" as const;
  readonly label = "Gemini";
  readonly capabilities = { referenceImages: true, exactSize: false, requiresApiKey: true };
  readonly defaultModel = GEMINI_IMAGE_MODEL;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: GeminiImageEngineOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  get model(): string {
    return this.opts.model ?? GEMINI_IMAGE_MODEL;
  }

  async detect(): Promise<ImageEngineAvailability> {
    try {
      return (await readApiKey(this.opts.apiKey))
        ? { available: true }
        : { available: false, reason: "No Google AI API key is configured." };
    } catch (error) {
      return { available: false, reason: `Could not read the API key: ${String(error)}` };
    }
  }

  async generate(input: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const request = normalizeRequest(this.id, input);
    const { signal, dispose } = deadline(
      this.id,
      request.timeoutMs ?? this.opts.timeoutMs ?? 120_000,
      request.signal,
    );
    try {
      const key = await readApiKey(this.opts.apiKey);
      if (!key)
        throw new ImageGenerationError(
          "unavailable",
          this.id,
          "No Google AI API key is configured",
        );
      const references = await readReferenceImages(this.id, request.referenceImages);
      const body = buildGeminiRequest(request, references);
      const url = `${(this.opts.baseUrl ?? GEMINI_API_BASE).replace(/\/$/, "")}/models/${encodeURIComponent(this.model)}:generateContent`;
      const replies = await Promise.all(
        Array.from({ length: request.count }, () =>
          postJson<GeminiResponse>(
            this.id,
            this.fetchImpl,
            url,
            { "x-goog-api-key": key },
            body,
            signal,
          ),
        ),
      );
      const images = replies.map((r) => parseGeminiImages(r)[0] as Buffer);
      const files = await writeImages(this.id, images, request.outputDir, request.fileStem);
      return { files, engine: this.id, model: this.model };
    } catch (error) {
      throw toImageError(error, this.id, signal);
    } finally {
      dispose();
    }
  }
}
