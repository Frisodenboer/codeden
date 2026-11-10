import type { ErrorKind } from "@codeden/contracts";
import { unixToIso } from "../util/text";
import type { CodexErrorInfo, RateLimitSnapshot } from "./protocol/v2";

/** Codex error codes worth trying the turn again for (overload, dropped connections). */
const TRANSIENT = new Set([
  "serverOverloaded",
  "internalServerError",
  "rateLimitExceeded",
  "flexUnavailable",
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
]);

/** The name of a `codexErrorInfo` (a string, or the single key of an object variant). */
function codeOf(info: CodexErrorInfo): string {
  return typeof info === "string" ? info : (Object.keys(info)[0] ?? "other");
}

/** Classify a failed Codex turn by its `codexErrorInfo` (§7.3 `ErrorInfo.kind`). */
export function classifyCodexError(info: CodexErrorInfo | null | undefined): ErrorKind {
  if (!info) return "fatal";
  const code = codeOf(info);
  if (code === "contextWindowExceeded") return "context_full";
  if (code === "usageLimitExceeded") return "usage_limit";
  if (code === "unauthorized") return "auth";
  return TRANSIENT.has(code) ? "transient" : "fatal";
}

/** The `codexErrorInfo` name, for `ErrorInfo.code`. */
export function codexErrorCode(info: CodexErrorInfo | null | undefined): string | undefined {
  return info ? codeOf(info) : undefined;
}

/**
 * When a reached usage limit lifts, from the latest rate-limit snapshot: the latest reset among
 * the windows that are used up (or any reset, when Codex says a limit is reached but no window
 * shows 100%).
 */
export function usageLimitResetsAt(snapshot: RateLimitSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined;
  const windows = [snapshot.primary, snapshot.secondary].filter((w) => w !== null);
  const full = windows.filter((w) => w.usedPercent >= 100);
  const candidates = (full.length > 0 ? full : windows)
    .map((w) => w.resetsAt)
    .filter((t): t is number => typeof t === "number");
  if (candidates.length === 0) return undefined;
  return unixToIso(full.length > 0 ? Math.max(...candidates) : Math.min(...candidates));
}
