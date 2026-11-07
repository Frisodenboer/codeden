import { codeForHttpStatus, ImageGenerationError, toImageError } from "./errors";
import type { ImageEngineId } from "./types";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** An API key, or a function that reads it on demand (from the OS keychain). */
export type ApiKeySource = string | (() => string | undefined | Promise<string | undefined>);

export async function readApiKey(source: ApiKeySource | undefined): Promise<string | undefined> {
  if (source === undefined) return undefined;
  const key = typeof source === "string" ? source : await source();
  return key?.trim() || undefined;
}

/** POST JSON and parse the JSON reply, mapping HTTP failures to `ImageGenerationError`. */
export async function postJson<T>(
  engine: ImageEngineId,
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw toImageError(signal.reason, engine, signal);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw toImageError(error, engine, signal);
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const code = codeForHttpStatus(response.status, text);
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    throw new ImageGenerationError(
      code,
      engine,
      `${engine} image API returned ${response.status}: ${apiErrorMessage(text)}`,
      { status: response.status, ...(retryAfter ? { retryAfter } : {}) },
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ImageGenerationError(
      "provider_error",
      engine,
      "The image API returned invalid JSON",
      {
        status: response.status,
        cause: error,
      },
    );
  }
}

/** The `error.message` of a typical JSON error body, else the raw text (trimmed). */
export function apiErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch {
    // not JSON
  }
  return text.trim().slice(0, 500) || "no details";
}

function parseRetryAfter(value: string | null): Date | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return new Date(Date.now() + seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
