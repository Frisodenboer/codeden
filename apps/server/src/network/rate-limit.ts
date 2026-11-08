/** Failures allowed before each attempt has to wait. */
const FREE_FAILURES = 3;
/** First wait once the free failures are used up; it doubles with each failure. */
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
/** This many failures inside the window lock the address out. */
const LOCKOUT_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

interface AddressRecord {
  /** Times of failures inside the window, oldest first. */
  failures: number[];
  lockedUntil: number;
}

export type SignInGate =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "locked_out"; retryAfterMs: number };

/**
 * Sign-in throttling per client address (§15.1). Only failed attempts count. After three
 * failures each attempt waits 1 s, 2 s, 4 s … up to 30 s after the last failure; ten failures
 * within 15 minutes lock the address out for 15 minutes. Other addresses are unaffected, and a
 * successful sign-in clears the address. Kept in memory: a restart forgets it.
 */
export class SignInLimiter {
  private readonly records = new Map<string, AddressRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Wait required before the `failures`-th failure may be followed by another attempt. */
  static delayAfter(failures: number): number {
    if (failures < FREE_FAILURES) return 0;
    return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failures - FREE_FAILURES));
  }

  /** May `address` try a password now? */
  check(address: string): SignInGate {
    const record = this.prune(address);
    if (!record) return { allowed: true };
    const now = this.now();
    if (record.lockedUntil > now) {
      return { allowed: false, reason: "locked_out", retryAfterMs: record.lockedUntil - now };
    }
    const last = record.failures.at(-1);
    const wait =
      last === undefined ? 0 : last + SignInLimiter.delayAfter(record.failures.length) - now;
    return wait > 0
      ? { allowed: false, reason: "rate_limited", retryAfterMs: wait }
      : { allowed: true };
  }

  /** Record a wrong password from `address`. */
  fail(address: string): void {
    const now = this.now();
    const record = this.prune(address) ?? { failures: [], lockedUntil: 0 };
    record.failures.push(now);
    if (record.failures.length >= LOCKOUT_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
      record.failures = [];
    }
    this.records.set(address, record);
  }

  /** A correct password: forget the address's failures. */
  succeed(address: string): void {
    this.records.delete(address);
  }

  /** Drop failures older than the window; returns the record if anything is left. */
  private prune(address: string): AddressRecord | undefined {
    const record = this.records.get(address);
    if (!record) return undefined;
    const now = this.now();
    record.failures = record.failures.filter((t) => now - t < WINDOW_MS);
    if (record.failures.length === 0 && record.lockedUntil <= now) {
      this.records.delete(address);
      return undefined;
    }
    return record;
  }
}
