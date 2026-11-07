import type {
  AgentEvent,
  ModelInfo,
  ProviderCapabilities,
  ProviderInfo,
  ProviderStatus,
  RuntimeResponse,
  SessionOptions,
  UserInput,
} from "@codeden/contracts";

/**
 * A provider adapter (§7.1), loaded by the runner. One instance per provider; it opens any
 * number of sessions. Adapters translate provider-native protocols into `AgentEvent`s and
 * never leak provider-specific shapes.
 */
export interface ProviderAdapter {
  /** `claude`, `codex`, `fake`, ... */
  readonly id: string;
  readonly displayName: string;
  /** Installed? Version? Logged in? (§14). Must not throw; report problems as issues. */
  detect(): Promise<ProviderStatus>;
  /** Honest capability flags (Principle 5). */
  capabilities(): ProviderCapabilities;
  /** Models the provider offers. */
  models(): ModelInfo[];
  openSession(opts: SessionOptions): Promise<ProviderSession>;
}

/** A live provider session. */
export interface ProviderSession {
  /** Normalized event stream. Ends after `close()` or when the provider process exits. */
  readonly events: AsyncIterable<AgentEvent>;
  /** Start a turn. Rejects if a turn is already running. */
  send(input: UserInput): Promise<void>;
  /** Inject input into the running turn. Present only when `capabilities().steer`. */
  steer?(input: UserInput): Promise<void>;
  /** Stop the running turn; emits `turn.interrupted`. No-op when idle. */
  interrupt(): Promise<void>;
  /** Answer an `approval_request` or `user_question` by its `requestId`. */
  respond(requestId: string, response: RuntimeResponse): Promise<void>;
  /** Close the session and end `events`. Idempotent. */
  close(): Promise<void>;
  /** Provider session/thread id for resume, once known. */
  resumeToken(): string | undefined;
}

/** Static description of an adapter, as sent in the runner handshake. */
export function providerInfo(adapter: ProviderAdapter): ProviderInfo {
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    capabilities: adapter.capabilities(),
    models: adapter.models(),
  };
}

/** Error thrown by sessions for invalid calls (unknown request id, turn already running). */
export class ProviderSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderSessionError";
  }
}
