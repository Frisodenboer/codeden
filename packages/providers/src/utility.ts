/** A one-shot request to the utility model (§7.4): no tools, no session, text in, text out. */
export interface OneShotRequest {
  prompt: string;
  /** Provider model id; each provider picks a small default when omitted. */
  model?: string;
  /** System prompt replacing the provider's coding-agent prompt. */
  system?: string;
  /** Default 60s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The utility model: small side jobs (follow-up suggestions, read-aloud summaries, session
 * titles) run through an installed provider with no tools (§7.4).
 */
export interface UtilityModel {
  readonly providerId: string;
  /** The model used when a request names none. */
  readonly defaultModel: string;
  runOneShot(request: OneShotRequest): Promise<string>;
}

/** Abort signal that fires on the caller's signal or after `timeoutMs`. */
export function oneShotSignal(request: OneShotRequest): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Utility model timed out")),
    request.timeoutMs ?? 60_000,
  );
  const onAbort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    },
  };
}
