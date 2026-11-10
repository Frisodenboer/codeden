import type { ErrorInfo, Session } from "@codeden/contracts";

/**
 * Whether a failed root turn is left for automatic retry to decide (`AutoRetry`): an agent
 * session's turn that failed for a passing reason (`transient`, or a `usage_limit`). The
 * reducer leaves such a session idle with no inbox item; the auto-retry service then either
 * schedules the retry or fails the session the usual way. Orchestrator and PM sessions, and
 * every other failure, fail at once. Pure.
 */
export function awaitsRetryDecision(session: Session, error: ErrorInfo): boolean {
  return session.role === "agent" && (error.kind === "transient" || error.kind === "usage_limit");
}
