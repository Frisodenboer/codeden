import type { ErrorInfo, ErrorKind } from "@codeden/contracts";
import { str, unixToIso } from "../util/text";

type Raw = Record<string, unknown>;

/** What a turn told us about its failure before its `result` arrived. */
export interface TurnErrorSignals {
  /** The `error` of the turn's last failed assistant message (`rate_limit`, `overloaded`, …). */
  assistantError?: string;
  /** When the usage window that rejected a request resets (from `rate_limit_event`). */
  rejectedResetsAt?: string;
}

/** Assistant errors that need the user's login or account. */
const AUTH_ERRORS = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
  "verification_required",
  "cloud_credential_error",
]);

/** Assistant errors Claude Code reports for a request worth trying again. */
const TRANSIENT_ERRORS = new Set(["overloaded", "server_error", "max_output_tokens"]);

/** Why a turn stopped that no retry will fix. */
const FATAL_REASONS = new Set([
  "max_turns",
  "budget_exhausted",
  "image_error",
  "structured_output_retry_exhausted",
  "malformed_tool_use_exhausted",
]);

/** Claude Code's usage limit cut the turn off. */
const LIMIT_REASONS = new Set(["blocking_limit", "rapid_refill_breaker"]);

/** The reset time of a rejected usage window in a `rate_limit_event`, if it was rejected. */
export function rejectedResetsAt(event: Raw): string | undefined {
  const info = event.rate_limit_info;
  if (!info || typeof info !== "object") return undefined;
  if (str(info, "status") !== "rejected") return undefined;
  const resetsAt = (info as Raw).resetsAt;
  return typeof resetsAt === "number" ? unixToIso(resetsAt) : undefined;
}

/**
 * Classify a turn that ended badly (`result` with an error subtype or `is_error`), from the
 * result's `terminal_reason` and `api_error_status`, the turn's assistant error and the last
 * rejected usage window (§7.3 `ErrorInfo.kind`).
 */
export function classifyResult(msg: Raw, signals: TurnErrorSignals): ErrorKind {
  const subtype = str(msg, "subtype");
  const reason = str(msg, "terminal_reason");
  const status = typeof msg.api_error_status === "number" ? msg.api_error_status : undefined;
  const error = signals.assistantError;
  const text = [str(msg, "result"), ...(Array.isArray(msg.errors) ? msg.errors : [])]
    .filter((t): t is string => typeof t === "string")
    .join("\n");

  if (reason === "prompt_too_long" || /prompt is too long|context (window|length)/i.test(text)) {
    return "context_full";
  }
  if ((error && AUTH_ERRORS.has(error)) || status === 401 || status === 403) return "auth";
  if (reason && LIMIT_REASONS.has(reason)) return "usage_limit";
  if (error === "rate_limit" || status === 429) {
    // A rejected usage window is a usage limit; otherwise it is short-lived throttling.
    return signals.rejectedResetsAt ? "usage_limit" : "transient";
  }
  if (subtype === "error_max_turns" || subtype === "error_max_budget_usd") return "fatal";
  if (reason && FATAL_REASONS.has(reason)) return "fatal";
  if (error && TRANSIENT_ERRORS.has(error)) return "transient";
  if (status !== undefined && status >= 500) return "transient";
  if (reason === "api_error" || reason === "aborted_streaming") return "transient";
  if (subtype === "error_during_execution" && !error) return "transient";
  return "fatal";
}

/** The `ErrorInfo` of a failed turn's `result`. */
export function resultError(msg: Raw, signals: TurnErrorSignals): ErrorInfo {
  const subtype = str(msg, "subtype");
  const errors = Array.isArray(msg.errors) ? msg.errors.filter((e) => typeof e === "string") : [];
  const message =
    errors.join("\n") || str(msg, "result") || `Claude turn ended with ${subtype ?? "an error"}`;
  const kind = classifyResult(msg, signals);
  const retryAt = kind === "usage_limit" ? signals.rejectedResetsAt : undefined;
  return {
    code: signals.assistantError ?? str(msg, "terminal_reason") ?? subtype ?? "error",
    message,
    retryable: kind === "transient" || kind === "usage_limit",
    kind,
    ...(retryAt ? { retryAt } : {}),
  };
}
