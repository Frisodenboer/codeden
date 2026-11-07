/**
 * Outcome of one wake attempt. `busy` retries with backoff (the debounce, doubling up to
 * `maxRetryMs`) at most `maxBusyRetries` times; `empty` drops the request.
 */
export type WakeResult = "sent" | "busy" | "empty";

export interface WakeSchedulerOptions {
  /** Quiet period after the last notice before waking (default 5 s). */
  debounceMs?: number;
  /** Longest a notice waits while more keep arriving (default 30 s). */
  maxWaitMs?: number;
  /** Loop guard: at most this many wakes per target per window (default 6). */
  maxWakes?: number;
  /** Loop guard window (default 10 minutes). */
  windowMs?: number;
  /** Longest wait between retries of a busy target (default 2 minutes). */
  maxRetryMs?: number;
  /**
   * Busy retries before giving up (default 20, about half an hour with the defaults). The
   * notices stay undelivered and ride along with the target's next message, or the next
   * notice arms a fresh wake.
   */
  maxBusyRetries?: number;
  /** Called when a wake is given up after `maxBusyRetries` busy attempts. */
  onGaveUp?: (key: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called once when the loop guard starts holding wakes back for a target. */
  onSuppressed?: (key: string, until: number) => void;
}

interface Pending {
  firstAt: number;
  timer: unknown;
  suppressed: boolean;
  /** Busy attempts so far. */
  retries: number;
}

/**
 * Batches notices into debounced wakes per target (`pm:<projectId>`, `orchestrator`) with a
 * loop guard (§8.2): notices arriving close together become one "updates since your last
 * turn" wake, and no target is woken more than `maxWakes` times per window. Held-back wakes
 * fire as soon as the window allows; nothing is dropped.
 */
export class WakeScheduler {
  private readonly pending = new Map<string, Pending>();
  private readonly history = new Map<string, number[]>();
  private readonly opts: Required<Omit<WakeSchedulerOptions, "onSuppressed" | "onGaveUp">> &
    Pick<WakeSchedulerOptions, "onSuppressed" | "onGaveUp">;

  constructor(
    private readonly fire: (key: string) => Promise<WakeResult>,
    opts: WakeSchedulerOptions = {},
  ) {
    this.opts = {
      debounceMs: opts.debounceMs ?? 5_000,
      maxWaitMs: opts.maxWaitMs ?? 30_000,
      maxWakes: opts.maxWakes ?? 6,
      windowMs: opts.windowMs ?? 10 * 60_000,
      maxRetryMs: opts.maxRetryMs ?? 2 * 60_000,
      maxBusyRetries: opts.maxBusyRetries ?? 20,
      onGaveUp: opts.onGaveUp,
      now: opts.now ?? Date.now,
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)),
      onSuppressed: opts.onSuppressed,
    };
  }

  /** A wake-worthy notice arrived for `key`: (re)start its debounce. */
  request(key: string): void {
    const now = this.opts.now();
    const entry = this.pending.get(key);
    if (entry) {
      if (entry.suppressed) return;
      entry.retries = 0; // fresh news: retry from the short delay again
      this.opts.clearTimer(entry.timer);
      const at = Math.min(now + this.opts.debounceMs, entry.firstAt + this.opts.maxWaitMs);
      entry.timer = this.arm(key, at - now);
      return;
    }
    this.pending.set(key, {
      firstAt: now,
      timer: this.arm(key, this.opts.debounceMs),
      suppressed: false,
      retries: 0,
    });
  }

  /** Whether `key` may be woken now (loop guard). */
  allowed(key: string): boolean {
    return this.recent(key).length < this.opts.maxWakes;
  }

  /** Count a wake that happened outside the scheduler (a direct message). */
  recordWake(key: string): void {
    this.history.set(key, [...this.recent(key), this.opts.now()]);
  }

  /** Whether a wake is waiting for `key`. */
  isPending(key: string): boolean {
    return this.pending.has(key);
  }

  dispose(): void {
    for (const entry of this.pending.values()) this.opts.clearTimer(entry.timer);
    this.pending.clear();
  }

  private recent(key: string): number[] {
    const since = this.opts.now() - this.opts.windowMs;
    const kept = (this.history.get(key) ?? []).filter((t) => t > since);
    this.history.set(key, kept);
    return kept;
  }

  private arm(key: string, ms: number): unknown {
    return this.opts.setTimer(() => void this.run(key), Math.max(0, ms));
  }

  private async run(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    const recent = this.recent(key);
    if (recent.length >= this.opts.maxWakes) {
      const until = (recent[0] ?? this.opts.now()) + this.opts.windowMs;
      if (!entry.suppressed) this.opts.onSuppressed?.(key, until);
      entry.suppressed = true;
      entry.timer = this.arm(key, until - this.opts.now() + 1);
      return;
    }
    let result: WakeResult;
    try {
      result = await this.fire(key);
    } catch {
      result = "busy";
    }
    if (result === "busy") {
      entry.suppressed = false;
      entry.retries++;
      if (entry.retries > this.opts.maxBusyRetries) {
        this.pending.delete(key);
        this.opts.onGaveUp?.(key);
        return;
      }
      const backoff = this.opts.debounceMs * 2 ** (entry.retries - 1);
      entry.timer = this.arm(key, Math.min(backoff, this.opts.maxRetryMs));
      return;
    }
    this.pending.delete(key);
    if (result === "sent") this.recordWake(key);
  }
}
