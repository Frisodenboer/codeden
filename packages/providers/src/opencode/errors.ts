import type { ErrorKind } from "@codeden/contracts";
import type { OcError } from "./types";

/** A classified opencode error, ready for `ErrorInfo`. */
export interface ClassifiedError {
  code: string;
  message: string;
  kind: ErrorKind;
  detail?: string;
}

/**
 * Usage or balance limits, as GLM (Z.AI) and others word them: Z.AI uses business codes
 * 1113 (balance), 1308/1310 (usage limit reached) and Chinese messages.
 */
const USAGE_LIMIT =
  /\b(1113|1308|1310)\b|usage limit|quota|insufficient (balance|credit|funds)|balance|credits? (exhausted|ran out)|余额|额度|限额/i;
const AUTH = /\b(401|403)\b|unauthori[sz]ed|invalid api key|token expired|authentication/i;

/** Classify an opencode message/session error (§7.3 `ErrorInfo.kind`). */
export function classifyOpencodeError(error: OcError | undefined): ClassifiedError {
  const name = error?.name ?? "UnknownError";
  const data = error?.data ?? {};
  const message = (typeof data.message === "string" && data.message) || name;
  const body = typeof data.responseBody === "string" ? data.responseBody.slice(0, 2000) : undefined;
  const text = `${message}\n${body ?? ""}`;
  const out = (kind: ErrorKind, code = name): ClassifiedError => ({
    code,
    message,
    kind,
    ...(body ? { detail: body } : {}),
  });
  switch (name) {
    case "ProviderAuthError":
      return out("auth", "provider_auth");
    case "ContextOverflowError":
      return out("context_full", "context_overflow");
    case "MessageOutputLengthError":
      return out("fatal", "output_length");
    case "APIError": {
      const status = typeof data.statusCode === "number" ? data.statusCode : undefined;
      if (status === 401 || status === 403) return out("auth", "unauthorized");
      if (USAGE_LIMIT.test(text)) return out("usage_limit", "usage_limit");
      if (status === 429 || (status !== undefined && status >= 500) || data.isRetryable)
        return out("transient", status === 429 ? "rate_limited" : "api_error");
      return out("fatal", "api_error");
    }
    default:
      if (USAGE_LIMIT.test(text)) return out("usage_limit", "usage_limit");
      if (AUTH.test(text)) return out("auth", "unauthorized");
      return out("fatal", name === "UnknownError" ? "unknown_error" : name);
  }
}

/** True for the error opencode reports when a turn was aborted. */
export function isAbortError(error: OcError | undefined): boolean {
  return error?.name === "MessageAbortedError";
}
