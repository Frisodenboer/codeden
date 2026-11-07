import type {
  AgentEvent,
  ProviderStatus,
  RuntimeResponse,
  SessionOptions,
  UserInput,
} from "@codeden/contracts";
import type { ProviderAdapter, ProviderSession } from "../adapter";
import { AsyncQueue } from "../async-queue";
import { type ReplayFixture, type ReplayTurn, sanitizeFixture } from "./fixture";

/**
 * Wraps a live session and records its normalized events into a `ReplayFixture`. Events are
 * bucketed per `send()`: everything until the next send belongs to that turn.
 */
export class RecordingSession implements ProviderSession {
  readonly events = new AsyncQueue<AgentEvent>();
  private readonly preamble: AgentEvent[] = [];
  private readonly turns: ReplayTurn[] = [];
  readonly steer?: (input: UserInput) => Promise<void>;

  constructor(
    private readonly inner: ProviderSession,
    private readonly meta: {
      provider: ProviderAdapter;
      status: ProviderStatus | null;
      scenario: string;
      options: SessionOptions;
    },
  ) {
    if (inner.steer) this.steer = (input) => inner.steer?.(input) ?? Promise.resolve();
    void this.pump();
  }

  private async pump(): Promise<void> {
    for await (const event of this.inner.events) {
      const turn = this.turns.at(-1);
      if (turn) turn.events.push(event);
      else this.preamble.push(event);
      this.events.push(event);
    }
    this.events.close();
  }

  async send(input: UserInput): Promise<void> {
    this.turns.push({ input, events: [], responses: {} });
    await this.inner.send(input);
  }

  interrupt(): Promise<void> {
    return this.inner.interrupt();
  }

  async respond(requestId: string, response: RuntimeResponse): Promise<void> {
    const turn = this.turns.at(-1);
    if (turn) turn.responses[requestId] = response;
    await this.inner.respond(requestId, response);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  resumeToken(): string | undefined {
    return this.inner.resumeToken();
  }

  /** The recording so far, with the cwd and session id replaced by placeholders. */
  fixture(): ReplayFixture {
    const { provider, status, scenario, options } = this.meta;
    const raw: ReplayFixture = {
      version: 1,
      provider: provider.id,
      scenario,
      recordedAt: new Date().toISOString(),
      cliVersion: status?.version ?? null,
      autonomy: options.autonomy,
      model: options.model ?? null,
      capabilities: provider.capabilities(),
      preamble: this.preamble,
      turns: this.turns,
    };
    return sanitizeFixture(structuredClone(raw), options.cwd, options.sessionId);
  }
}
