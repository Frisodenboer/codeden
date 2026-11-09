/** One thing to read aloud. */
export interface SpeechItem {
  /** Identity for de-duplication: the same key is never queued twice (a turn id). */
  key: string;
  /** Checked when the item's turn comes and when `recheck` runs; false skips or stops it. */
  allowed?: () => boolean;
  /**
   * Speak the item, resolving when playback ends or is stopped. `signal` aborts when the item
   * is stopped (cleared, interrupted or no longer allowed) before or during playback.
   */
  play: (signal: AbortSignal) => Promise<void>;
}

/**
 * Newest finishes matter most, so a burst keeps only the latest few: with TL;DRs of about 15 s,
 * three pending items is under a minute of backlog.
 */
export const MAX_PENDING = 3;

/**
 * One global first-in, first-out queue for read-aloud (§11.3): a message plays to the end
 * before the next one starts, whichever session it came from. Items are skipped when their
 * turn comes if they are no longer allowed (muted, quiet hours, read-aloud off); when more
 * than `maxPending` wait, the oldest waiting item is dropped. `playNow` (the settings Test
 * button) jumps the queue, stopping whatever is playing.
 */
export class SpeechQueue {
  private pending: SpeechItem[] = [];
  private readonly seen = new Set<string>();
  private current: { item: SpeechItem; controller: AbortController } | null = null;
  private running = false;

  constructor(
    private readonly opts: {
      /** Stop the audio that is playing right now. */
      stopAudio: () => void;
      maxPending?: number;
    },
  ) {}

  /** Whether `key` was queued before (it will not be queued again). */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  /** Queue an item; false when its key was queued before. */
  enqueue(item: SpeechItem): boolean {
    if (this.seen.has(item.key)) return false;
    this.seen.add(item.key);
    this.pending.push(item);
    const max = this.opts.maxPending ?? MAX_PENDING;
    if (this.pending.length > max) this.pending.splice(0, this.pending.length - max);
    void this.pump();
    return true;
  }

  /** Play `item` straight away, stopping the current one; the queue carries on after it. */
  playNow(item: SpeechItem): void {
    this.pending.unshift(item);
    this.stopCurrent();
    void this.pump();
  }

  /** Stop what is playing and drop everything waiting. */
  clear(): void {
    this.pending = [];
    this.stopCurrent();
  }

  /** Stop the current item if it is no longer allowed (e.g. its session was just muted). */
  recheck(): void {
    if (this.current?.item.allowed && !this.current.item.allowed()) this.stopCurrent();
  }

  /** Keys of the items waiting, oldest first (for tests and diagnostics). */
  waiting(): string[] {
    return this.pending.map((i) => i.key);
  }

  get playing(): string | null {
    return this.current?.item.key ?? null;
  }

  private stopCurrent(): void {
    if (!this.current) return;
    this.current.controller.abort();
    this.opts.stopAudio();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let item = this.pending.shift(); item; item = this.pending.shift()) {
        if (item.allowed && !item.allowed()) continue;
        const controller = new AbortController();
        this.current = { item, controller };
        try {
          await item.play(controller.signal);
        } catch {
          // A failed item (audio blocked, network) must not stall the queue.
        } finally {
          this.current = null;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
