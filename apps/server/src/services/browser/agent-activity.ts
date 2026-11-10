/** How long the "Agent is acting" signal lingers after the last agent browser command. */
export const AGENT_ACTIVITY_DECAY_MS = 2_500;

type Listener = (sessionId: string, acting: boolean) => void;

interface SessionActivity {
  inFlight: number;
  acting: boolean;
  timer?: NodeJS.Timeout;
}

/**
 * Tracks when agents drive a session's browser (§12.2): a session is "acting" while an agent
 * `browser.*` command runs and for `decayMs` after the last one ends, so a burst of tool calls
 * reads as one stretch of activity. Listeners hear only transitions.
 */
export class AgentActivity {
  private readonly sessions = new Map<string, SessionActivity>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly decayMs = AGENT_ACTIVITY_DECAY_MS) {}

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isActing(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.acting ?? false;
  }

  /** Run an agent command, marking the session acting around it. */
  async track<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    this.begin(sessionId);
    try {
      return await run();
    } finally {
      this.end(sessionId);
    }
  }

  begin(sessionId: string): void {
    const s = this.sessions.get(sessionId) ?? { inFlight: 0, acting: false };
    this.sessions.set(sessionId, s);
    s.inFlight += 1;
    clearTimeout(s.timer);
    s.timer = undefined;
    this.set(sessionId, s, true);
  }

  end(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.inFlight = Math.max(0, s.inFlight - 1);
    if (s.inFlight > 0) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = undefined;
      this.set(sessionId, s, false);
      this.sessions.delete(sessionId);
    }, this.decayMs);
    s.timer.unref?.();
  }

  private set(sessionId: string, s: SessionActivity, acting: boolean): void {
    if (s.acting === acting) return;
    s.acting = acting;
    for (const l of this.listeners) l(sessionId, acting);
  }
}
