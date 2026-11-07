import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ImageGenerationError } from "./errors";
import { imageInfo } from "./image-file";
import {
  IMAGE_ASPECT_RATIOS,
  type ImageEngineId,
  type ImageGenerateRequest,
  MAX_IMAGE_COUNT,
} from "./types";

/** Largest reference image accepted (bytes); matches the strictest provider limit. */
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 8;

export type ParsedSize =
  | { kind: "pixels"; width: number; height: number }
  | { kind: "class"; value: "1K" | "2K" | "4K" };

/** `1024x1536` -> pixels, `2K` -> class, anything else -> `undefined`. */
export function parseSize(size: string): ParsedSize | undefined {
  const px = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/i.exec(size);
  if (px) return { kind: "pixels", width: Number(px[1]), height: Number(px[2]) };
  const cls = /^\s*([124])k\s*$/i.exec(size);
  if (cls) return { kind: "class", value: `${cls[1]}K` as "1K" | "2K" | "4K" };
  return undefined;
}

/** Validated request with defaults applied. Throws `invalid_request`. */
export function normalizeRequest(
  engine: ImageEngineId,
  request: ImageGenerateRequest,
): ImageGenerateRequest & { count: number; fileStem: string; referenceImages: string[] } {
  const bad = (message: string) => new ImageGenerationError("invalid_request", engine, message);
  if (!request.prompt?.trim()) throw bad("The prompt is empty");
  const count = request.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_COUNT) {
    throw bad(`count must be an integer from 1 to ${MAX_IMAGE_COUNT}`);
  }
  if (request.aspectRatio && !IMAGE_ASPECT_RATIOS.includes(request.aspectRatio)) {
    throw bad(`Unsupported aspect ratio ${request.aspectRatio}`);
  }
  if (request.size && request.size !== "auto" && !parseSize(request.size)) {
    throw bad(`size must look like 1024x1024 or 2K, got ${request.size}`);
  }
  if (!path.isAbsolute(request.outputDir)) throw bad("outputDir must be an absolute path");
  const referenceImages = request.referenceImages ?? [];
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw bad(`At most ${MAX_REFERENCE_IMAGES} reference images are supported`);
  }
  for (const ref of referenceImages) {
    if (!path.isAbsolute(ref)) throw bad(`Reference image paths must be absolute: ${ref}`);
  }
  return { ...request, count, fileStem: request.fileStem ?? "image", referenceImages };
}

export interface ReferenceImage {
  path: string;
  mimeType: string;
  data: Buffer;
}

/** Read and type-check reference images. Throws `invalid_request` / `io`. */
export async function readReferenceImages(
  engine: ImageEngineId,
  paths: readonly string[],
): Promise<ReferenceImage[]> {
  const out: ReferenceImage[] = [];
  for (const file of paths) {
    let data: Buffer;
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error("not a file");
      if (st.size > MAX_REFERENCE_BYTES) {
        throw new ImageGenerationError(
          "invalid_request",
          engine,
          `Reference image is larger than ${MAX_REFERENCE_BYTES / 1024 / 1024} MB: ${file}`,
        );
      }
      data = await readFile(file);
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError("io", engine, `Cannot read reference image ${file}`, {
        cause: error,
      });
    }
    const meta = imageInfo(data);
    if (!meta) {
      throw new ImageGenerationError(
        "invalid_request",
        engine,
        `Reference image is not a PNG, JPEG, WebP or GIF: ${file}`,
      );
    }
    out.push({ path: file, mimeType: meta.mimeType, data });
  }
  return out;
}

/** Width / height ratio implied by `size` or `aspectRatio`; `undefined` = engine default. */
export function requestedRatio(request: Pick<ImageGenerateRequest, "size" | "aspectRatio">) {
  const size = request.size ? parseSize(request.size) : undefined;
  if (size?.kind === "pixels") return size.width / size.height;
  if (request.aspectRatio) {
    const [w, h] = request.aspectRatio.split(":").map(Number);
    return (w ?? 1) / (h ?? 1);
  }
  return undefined;
}

/** The supported ratio closest to `ratio` (compared in log space, so 2:1 and 1:2 are symmetric). */
export function nearestAspectRatio<T extends string>(ratio: number, allowed: readonly T[]): T {
  let best = allowed[0] as T;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const [w, h] = candidate.split(":").map(Number);
    const diff = Math.abs(Math.log((w ?? 1) / (h ?? 1)) - Math.log(ratio));
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

export type Orientation = "square" | "landscape" | "portrait";

export function orientationOf(ratio: number | undefined): Orientation | undefined {
  if (ratio === undefined) return undefined;
  if (ratio > 1.1) return "landscape";
  if (ratio < 1 / 1.1) return "portrait";
  return "square";
}

/**
 * An AbortSignal that fires on the caller's signal (`aborted`) or after `timeoutMs`
 * (`timeout`), with an `ImageGenerationError` as the reason.
 */
export function deadline(
  engine: ImageEngineId,
  timeoutMs: number,
  outer?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new ImageGenerationError(
          "timeout",
          engine,
          `Image generation timed out after ${Math.round(timeoutMs / 1000)}s`,
        ),
      ),
    timeoutMs,
  );
  const onAbort = () =>
    controller.abort(
      new ImageGenerationError("aborted", engine, "Image generation was cancelled", {
        cause: outer?.reason,
      }),
    );
  if (outer?.aborted) onAbort();
  else outer?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}
