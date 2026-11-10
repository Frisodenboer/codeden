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
  /** A wake attempt is in flight (`fire` has not settled). */
  firing: boolean;
  /** A notice arrived while the attempt was in flight: wake again once it settles. */
  again: boolean;
}

/**
 * Batches notices into debounced wakes per target (`pm:<projectId>`, `orchestrator`) with a
 * loop guard (§8.2): notices arriving close together become one "updates since your last
 * turn" wake, and no target is woken more than `maxWakes` times per window. Held-back wakes
 * fire as soon as the window allows, or right after `reset` when a person steps in; nothing
 * is dropped. The orchestration service runs one for notice wakes and one for the
 * orchestrator's messages to PMs (`LoopGuard`), so each conversation is counted on its own.
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
      // The wake in flight may already have read the notices; this one waits for the next.
      if (entry.firing) {
        entry.again = true;
        return;
      }
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
      firing: false,
      again: false,
    });
  }

  /** Whether `key` may be woken now (loop guard). */
  allowed(key: string): boolean {
    return this.recent(key).length < this.opts.maxWakes;
  }

  /** When the loop guard lets `key` be woken again (now, while it is under the limit). */
  freeAt(key: string): number {
    const recent = this.recent(key);
    const over = recent.length - this.opts.maxWakes;
    return over < 0 ? this.opts.now() : (recent[over] ?? this.opts.now()) + this.opts.windowMs;
  }

  /** Count a wake that happened outside the scheduler (a direct message). */
  recordWake(key: string): void {
    this.history.set(key, [...this.recent(key), this.opts.now()]);
  }

  /**
   * A person stepped in: forget `key`'s counted wakes, so whatever follows is not part of a
   * loop, and let a wake the guard was holding back go out after the usual quiet period.
   */
  reset(key: string): void {
    this.history.delete(key);
    const entry = this.pending.get(key);
    if (!entry?.suppressed || entry.firing) return;
    entry.suppressed = false;
    this.opts.clearTimer(entry.timer);
    entry.timer = this.arm(key, this.opts.debounceMs);
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
    if (!entry || entry.firing) return;
    if (!this.allowed(key)) {
      const until = this.freeAt(key);
      if (!entry.suppressed) this.opts.onSuppressed?.(key, until);
      entry.suppressed = true;
      entry.timer = this.arm(key, until - this.opts.now() + 1);
      return;
    }
    let result: WakeResult;
    entry.firing = true;
    entry.again = false;
    try {
      result = await this.fire(key);
    } catch {
      result = "busy";
    } finally {
      entry.firing = false;
    }
    if (this.pending.get(key) !== entry) return; // disposed meanwhile
    if (entry.again) {
      // Fresh news during the attempt: wake again after the quiet period, as `request` would.
      entry.again = false;
      entry.retries = 0;
      if (result === "sent") this.recordWake(key);
      if (result !== "busy") {
        entry.firstAt = this.opts.now();
        entry.timer = this.arm(key, this.opts.debounceMs);
        return;
      }
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
