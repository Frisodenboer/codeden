import { randomUUID } from "node:crypto";
import type { Notice, NoticeTarget } from "@codeden/contracts";
import { badRequest, conflict } from "../errors";
import type { NoticeStore } from "./notices";
import type { WakeScheduler } from "./wake-scheduler";

/** Who a wake-up belongs to: the orchestrator, or the PM of a project. */
export interface WakeupOwner {
  target: NoticeTarget;
  /** The PM's project; null for the orchestrator. */
  projectId: string | null;
  /** The role session that scheduled it. */
  sessionId: string | null;
}

export interface RemindersDeps {
  notices: Pick<NoticeStore, "create" | "scheduled" | "heldBack" | "markDelivered">;
  wakes: Pick<WakeScheduler, "request">;
  /** Shortest wait for a wake-up (default 1 minute). */
  minDelayMs?: number;
  log?: (message: string) => void;
}

const MAX_DELAY_MS = 7 * 24 * 60 * 60_000;
/** Pending wake-ups per owner. */
export const MAX_PENDING_WAKEUPS = 20;
/** Longest timer wait, so clock changes and sleep are noticed. */
const MAX_TIMER_MS = 60_000;

const keyOf = (n: Pick<Notice, "target" | "projectId">) =>
  n.target === "orchestrator" ? "orchestrator" : `pm:${n.projectId ?? ""}`;

/**
 * Wake-ups the orchestrator and PMs schedule for themselves (`schedule_wakeup`, §8.2), so they
 * can follow up later (check on a running audit, retry tomorrow) without the user prompting
 * them. Each is a `reminder` notice held back until `notBefore`: stored in the event log, so
 * it survives restarts, and delivered like any other notice, with a wake once it is due.
 */
export class Reminders {
  private timer: NodeJS.Timeout | undefined;
  private readonly requested = new Set<string>();
  private stopped = true;

  constructor(private readonly deps: RemindersDeps) {}

  start(): void {
    this.stopped = false;
    this.tick();
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Schedule a wake-up for `owner` at `at` with `note`. */
  schedule(owner: WakeupOwner, at: Date, note: string): Notice {
    const delay = at.getTime() - Date.now();
    const min = this.deps.minDelayMs ?? 60_000;
    if (!Number.isFinite(delay) || delay < min) {
      throw badRequest(
        `A wake-up must be at least ${Math.ceil(min / 60_000)} minute(s) ahead`,
        "wakeup_too_soon",
      );
    }
    if (delay > MAX_DELAY_MS) {
      throw badRequest("A wake-up can be at most 7 days ahead", "wakeup_too_late");
    }
    if (this.pending(owner.target, owner.projectId).length >= MAX_PENDING_WAKEUPS) {
      throw conflict(
        `You already have ${MAX_PENDING_WAKEUPS} wake-ups scheduled; cancel one first`,
        "too_many_wakeups",
      );
    }
    const notice = this.deps.notices.create({
      id: `reminder:${randomUUID()}`,
      type: "reminder",
      projectId: owner.projectId,
      target: owner.target,
      sessionId: null,
      title: "Wake-up you scheduled",
      wake: true,
      notBefore: at.toISOString(),
      data: { note, requestedBy: owner.sessionId },
    });
    if (!notice) throw conflict("That wake-up already exists", "wakeup_exists");
    this.tick();
    return notice;
  }

  /** An owner's wake-ups still to come (or due and not yet delivered), soonest first. */
  pending(target: NoticeTarget, projectId: string | null): Notice[] {
    return this.deps.notices.scheduled(target, projectId);
  }

  /** Cancel one of an owner's pending wake-ups; false when it has none with that id. */
  cancel(target: NoticeTarget, projectId: string | null, id: string): boolean {
    if (!this.pending(target, projectId).some((n) => n.id === id)) return false;
    // Settled without a wake: it never reaches the owner.
    this.deps.notices.markDelivered([id]);
    return true;
  }

  /** Wake the owners of wake-ups that just came due, then wait for the next one. */
  private tick(): void {
    if (this.stopped) return;
    try {
      for (const n of this.deps.notices.heldBack(true)) {
        if (this.requested.has(n.id)) continue;
        this.requested.add(n.id);
        this.deps.wakes.request(keyOf(n));
      }
    } catch (error) {
      this.deps.log?.(`orchestration wake-ups: ${error instanceof Error ? error.message : error}`);
    }
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const next = this.deps.notices.heldBack(false)[0]?.notBefore;
    if (!next) return;
    const wait = Math.min(Math.max(Date.parse(next) - Date.now(), 0), MAX_TIMER_MS);
    this.timer = setTimeout(() => this.tick(), wait + 5);
    this.timer.unref?.();
  }
}
