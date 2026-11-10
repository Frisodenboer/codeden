import type { ItemOf } from "@codeden/contracts";
import { str } from "../util/text";

type Raw = Record<string, unknown>;
type Notice = ItemOf<"notice">;

/** Words for the error kinds Claude Code reports on a retried API request. */
const RETRY_CAUSES: Record<string, string> = {
  rate_limit: "rate limited",
  overloaded: "overloaded",
  server_error: "server error",
};

const num = (raw: Raw, key: string): number | undefined =>
  typeof raw[key] === "number" ? (raw[key] as number) : undefined;

/**
 * A `system/api_retry` message as a transcript notice: Claude Code hit a retryable API error
 * and will try again by itself, so the user can see the session is still healthy (and not
 * press Stop on it). One notice per turn, updated in place by `id`.
 */
export function apiRetryNotice(msg: Raw, id: string): Notice {
  const attempt = num(msg, "attempt");
  const max = num(msg, "max_retries");
  const delayMs = num(msg, "retry_delay_ms");
  const status = num(msg, "error_status");
  const error = str(msg, "error");
  const cause = [error ? (RETRY_CAUSES[error] ?? error.replaceAll("_", " ")) : undefined, status]
    .filter((part) => part !== undefined)
    .join(", ");
  const wait = delayMs !== undefined ? ` in ${Math.max(1, Math.round(delayMs / 1000))}s` : "";
  const count = attempt !== undefined && max !== undefined ? ` (attempt ${attempt} of ${max})` : "";
  return {
    id,
    kind: "notice",
    status: "completed",
    level: "warning",
    code: "retrying",
    message: `The API request failed${cause ? ` (${cause})` : ""}; Claude Code retries${wait}${count}.`,
    data: {
      ...(attempt !== undefined ? { attempt } : {}),
      ...(max !== undefined ? { maxRetries: max } : {}),
      ...(delayMs !== undefined ? { retryDelayMs: delayMs } : {}),
      ...(status !== undefined ? { errorStatus: status } : {}),
      ...(error ? { error } : {}),
    },
  };
}

/** Claude Code started compacting the conversation (`system/status` `compacting`). */
export function compactingNotice(id: string): Notice {
  return {
    id,
    kind: "notice",
    status: "completed",
    level: "info",
    code: "compacting",
    message: "Compacting the conversation to free up context…",
  };
}

/** Compaction finished (`compact_boundary`); replaces the "compacting" notice. */
export function compactedNotice(id: string): Notice {
  return {
    id,
    kind: "notice",
    status: "completed",
    level: "info",
    code: "context_compacted",
    message: "Context compacted",
  };
}

/** Compaction failed (`system/status` with `compact_result: failed`). */
export function compactFailedNotice(id: string, msg: Raw): Notice {
  const error = str(msg, "compact_error");
  return {
    id,
    kind: "notice",
    status: "completed",
    level: "warning",
    code: "compact_failed",
    message: error
      ? `Compacting the conversation failed: ${error}`
      : "Compacting the conversation failed",
  };
}
