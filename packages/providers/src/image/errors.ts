import type { ImageEngineId } from "./types";

export type ImageErrorCode =
  /** Engine not installed, not logged in, or no API key. */
  | "unavailable"
  /** Bad prompt/size/count/reference image or output path. */
  | "invalid_request"
  /** The API rejected the credentials. */
  | "auth"
  /** Rate or usage limit hit; `retryAfter` says when, if known. */
  | "rate_limited"
  /** The provider refused the prompt or image on safety grounds. */
  | "content_policy"
  | "timeout"
  | "aborted"
  /** The call finished without producing an image. */
  | "no_image"
  /** Any other provider-side failure. */
  | "provider_error"
  /** Reading a reference image or writing an output file failed. */
  | "io";

const RETRYABLE: ReadonlySet<ImageErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "provider_error",
]);

/** The only error type `ImageEngine.generate()` throws. */
export class ImageGenerationError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: ImageErrorCode,
    readonly engine: ImageEngineId,
    message: string,
    readonly details: { status?: number; retryAfter?: Date; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ImageGenerationError";
    this.retryable = RETRYABLE.has(code);
  }
}

/** Map an HTTP status from an image API to an error code. */
export function codeForHttpStatus(status: number, body: string): ImageErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 400 && /safety|policy|moderation|blocked/i.test(body)) return "content_policy";
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider_error";
}

/** Wrap anything thrown during generation, keeping existing `ImageGenerationError`s. */
export function toImageError(
  error: unknown,
  engine: ImageEngineId,
  signal?: AbortSignal,
): ImageGenerationError {
  if (error instanceof ImageGenerationError) return error;
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof ImageGenerationError) return reason;
    return new ImageGenerationError("aborted", engine, "Image generation was cancelled", {
      cause: reason,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ImageGenerationError("provider_error", engine, message, { cause: error });
}
