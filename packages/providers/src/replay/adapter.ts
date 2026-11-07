import type {
  AgentEvent,
  ModelInfo,
  ProviderCapabilities,
  ProviderStatus,
  RuntimeResponse,
  SessionOptions,
  UserInput,
} from "@codeden/contracts";
import { type ProviderAdapter, type ProviderSession, ProviderSessionError } from "../adapter";
import { AsyncQueue } from "../async-queue";
import { instantiateFixture, type ReplayFixture } from "./fixture";

export interface ReplayProviderOptions {
  /** Adapter id; defaults to `replay`. */
  id?: string;
  /** Delay between events in ms (0 = yield only). */
  delayMs?: number;
}

class Interrupted extends Error {}

const isRootTurnEnd = (e: AgentEvent, rootThreadId: string) =>
  (e.type === "turn.completed" || e.type === "turn.failed" || e.type === "turn.interrupted") &&
  e.threadId === rootThreadId;

/**
 * Plays back a recorded session deterministically (§7.2): each `send()` emits the next
 * recorded turn's events. Recorded approval/question requests pause until `respond()` is
 * called for their request id; the recorded outcome then continues regardless of the answer.
 */
export class ReplaySession implements ProviderSession {
  readonly events = new AsyncQueue<AgentEvent>();
  private readonly fixture: ReplayFixture;
  private next = 0;
  private running: AbortController | undefined;
  private token: string | undefined;
  private readonly waiting = new Map<string, () => void>();
  private readonly rootThreadId: string;

  constructor(
    fixture: ReplayFixture,
    opts: SessionOptions,
    private readonly delayMs = 0,
  ) {
    this.fixture = instantiateFixture(fixture, opts.cwd, opts.sessionId);
    this.rootThreadId = `${opts.sessionId}:thread-root`;
    for (const event of this.fixture.preamble) this.emit(event);
  }

  resumeToken(): string | undefined {
    return this.token;
  }

  async send(_input: UserInput): Promise<void> {
    if (this.events.isClosed) throw new ProviderSessionError("closed", "Session is closed");
    if (this.running) throw new ProviderSessionError("turn_running", "A turn is already running");
    const turn = this.fixture.turns[this.next];
    if (!turn) throw new ProviderSessionError("no_recorded_turn", "The fixture has no more turns");
    this.next += 1;
    const abort = new AbortController();
    this.running = abort;
    void this.play(turn.events, abort).finally(() => {
      if (this.running === abort) this.running = undefined;
    });
  }

  async interrupt(): Promise<void> {
    this.running?.abort();
  }

  async respond(requestId: string, _response: RuntimeResponse): Promise<void> {
    const resume = this.waiting.get(requestId);
    if (!resume) throw new ProviderSessionError("unknown_request", `Unknown request ${requestId}`);
    this.waiting.delete(requestId);
    resume();
  }

  async close(): Promise<void> {
    this.running?.abort();
    await new Promise((r) => setImmediate(r));
    this.events.close();
  }

  private async play(events: AgentEvent[], abort: AbortController): Promise<void> {
    const signal = abort.signal;
    // Like the real adapters, the turn is marked idle before its terminal event is emitted,
    // so a consumer may `send()` as soon as it sees `turn.completed`.
    const idle = () => {
      if (this.running === abort) this.running = undefined;
    };
    let turnId: string | undefined;
    try {
      for (const event of events) {
        await this.step(signal);
        if (event.type === "turn.started" && event.threadId === this.rootThreadId) {
          turnId = event.turnId;
        }
        if (isRootTurnEnd(event, this.rootThreadId)) {
          turnId = undefined;
          idle();
        }
        this.emit(event);
        if (
          event.type === "item.started" &&
          (event.item.kind === "approval_request" || event.item.kind === "user_question")
        ) {
          await this.waitFor(event.item.requestId, signal);
        }
      }
    } catch (error) {
      if (!(error instanceof Interrupted)) throw error;
      idle();
      if (turnId) {
        this.emit({
          type: "turn.interrupted",
          threadId: this.rootThreadId,
          turnId,
          reason: "user",
        });
      }
    }
  }

  private waitFor(requestId: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.waiting.delete(requestId);
        reject(new Interrupted());
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.set(requestId, () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }

  private async step(signal: AbortSignal): Promise<void> {
    await new Promise((r) => (this.delayMs > 0 ? setTimeout(r, this.delayMs) : setImmediate(r)));
    if (signal.aborted) throw new Interrupted();
  }

  private emit(event: AgentEvent): void {
    if (event.type === "session.updated" && event.resumeToken) this.token = event.resumeToken;
    this.events.push(event);
  }
}

/** Replay adapter: serves sessions from one recorded fixture. Never spawns a CLI. */
export class ReplayProvider implements ProviderAdapter {
  readonly id: string;
  readonly displayName: string;

  constructor(
    private readonly fixture: ReplayFixture,
    private readonly options: ReplayProviderOptions = {},
  ) {
    this.id = options.id ?? "replay";
    this.displayName = `Replay (${fixture.provider}/${fixture.scenario})`;
  }

  async detect(): Promise<ProviderStatus> {
    return {
      providerId: this.id,
      installed: true,
      version: this.fixture.cliVersion,
      executablePath: null,
      loggedIn: true,
      authMethod: "none",
      account: null,
      loginExpiresAt: null,
      supported: true,
      issues: [],
      checkedAt: new Date().toISOString(),
    };
  }

  /** The recorded provider's capabilities, minus steering (replay can't inject input). */
  capabilities(): ProviderCapabilities {
    return { ...this.fixture.capabilities, steer: false };
  }

  models(): ModelInfo[] {
    const id = this.fixture.model ?? "recorded";
    return [{ id, label: id, efforts: [], isDefault: true }];
  }

  async openSession(opts: SessionOptions): Promise<ProviderSession> {
    return new ReplaySession(this.fixture, opts, this.options.delayMs ?? 0);
  }
}
