import type {
  AgentEventOf,
  Notice,
  RawEventEnvelope,
  Session,
  UserInput,
} from "@codeden/contracts";
import { NoticeBatchData } from "@codeden/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items } from "../../db/schema";
import { errorMessage } from "../errors";
import type { DecoratedInput } from "../sessions/input-decorator";
import type { NoticeCards } from "./cards";
import { renderNotices } from "./digest";
import type { NoticeStore } from "./notices";
import type { WakeScheduler } from "./wake-scheduler";

export interface NoticeDeliveryDeps {
  db: Db;
  notices: NoticeStore;
  cards: NoticeCards;
  wakes: Pick<WakeScheduler, "request">;
  /** The status digest for a role session's next turn. */
  digestFor: (session: Session) => string;
  projectName: (id: string) => string;
  session: (id: string) => Session | undefined;
  /** The projects whose PMs may be woken (not archived). */
  projectIds: () => string[];
  /**
   * Waits before waking a role session again after a turn that carried notices failed, one
   * per attempt (default 30 s, 2 min, 10 min). After the last, the notices wait for the
   * session's next message or notice.
   */
  retryDelaysMs?: number[];
  log?: (message: string) => void;
}

/** Whether a stored notice should wake its target (older notices didn't record it). */
export function wakesTarget(n: Notice): boolean {
  if (n.wake !== undefined) return n.wake;
  return !(n.type === "pm.message" && n.data.informational);
}

const keyOf = (session: Session) =>
  session.role === "pm" ? `pm:${session.projectId}` : "orchestrator";

/**
 * Getting notices to the orchestrator and the PMs (§8.2) reliably:
 *
 * - a turn's notices count as delivered only once the runner took the turn; until then they
 *   are claimed, so a message sent meanwhile doesn't carry them twice;
 * - on start, targets with wake-worthy notices still undelivered (a restart cut the wake off)
 *   are woken again;
 * - when a role session's turn that carried notices fails (an overloaded model, say), the
 *   notices go back to undelivered and the session is woken again a few times, backing off.
 */
export class NoticeDelivery {
  private readonly claimed = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly deps: NoticeDeliveryDeps) {}

  /** Prepend the status digest and the undelivered notices to a role session's input (§8.4). */
  decorate(session: Session, input: UserInput): DecoratedInput {
    if (session.role === "agent") return { input };
    try {
      const parts = [this.deps.digestFor(session)];
      const pending = this.deps.notices
        .undelivered(
          session.role === "pm" ? "pm" : "orchestrator",
          session.role === "pm" ? session.projectId : null,
        )
        .filter((n) => !this.claimed.has(n.id));
      parts.push(...(pending.length > 0 ? [renderNotices(pending, this.deps.projectName)] : []));
      parts.push(input.text);
      const ids = pending.map((n) => n.id);
      for (const id of ids) this.claimed.add(id);
      if (pending.length > 0) this.deps.cards.add(session.id, pending);
      const release = () => {
        for (const id of ids) this.claimed.delete(id);
      };
      return {
        input: { ...input, text: parts.join("\n\n") },
        delivered: () => {
          release();
          this.deps.notices.markDelivered(ids);
        },
        failed: () => {
          release();
          this.deps.cards.remove(session.id, ids);
        },
      };
    } catch (error) {
      this.deps.log?.(`orchestration digest: ${errorMessage(error)}`);
      return { input };
    }
  }

  /** Wake every target whose wake-worthy notices are still undelivered (server start). */
  rearm(): void {
    if (this.deps.notices.undelivered("orchestrator", null).some(wakesTarget)) {
      this.deps.wakes.request("orchestrator");
    }
    for (const id of this.deps.projectIds()) {
      if (this.deps.notices.undelivered("pm", id).some(wakesTarget)) {
        this.deps.wakes.request(`pm:${id}`);
      }
    }
  }

  /** Follow role sessions' root turns: a failed one returns its notices and retries. */
  onEvents(events: RawEventEnvelope[]): void {
    for (const e of events) {
      if (e.type !== "agent.turn.completed" && e.type !== "agent.turn.failed") continue;
      const session = e.sessionId ? this.deps.session(e.sessionId) : undefined;
      if (!session || session.role === "agent") continue;
      const event = e.payload as AgentEventOf<"turn.completed">;
      if (session.rootThreadId && session.rootThreadId !== event.threadId) continue;
      if (e.type === "agent.turn.completed") {
        this.failures.delete(session.id);
        continue;
      }
      this.turnFailed(session, event.turnId);
    }
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private turnFailed(session: Session, turnId: string): void {
    const carried = this.carried(session.id, turnId);
    if (carried.length === 0) return;
    this.deps.notices.markReturned(carried);
    const attempt = (this.failures.get(session.id) ?? 0) + 1;
    this.failures.set(session.id, attempt);
    const delays = this.deps.retryDelaysMs ?? [30_000, 2 * 60_000, 10 * 60_000];
    const delay = delays[attempt - 1];
    if (delay === undefined) {
      this.deps.log?.(
        `orchestration: ${keyOf(session)} keeps failing; its updates wait for its next message`,
      );
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.deps.wakes.request(keyOf(session));
    }, delay);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** Ids of the notices a turn carried (its batch of cards). */
  private carried(sessionId: string, turnId: string): string[] {
    const row = this.deps.db
      .select()
      .from(items)
      .where(
        and(
          eq(items.sessionId, sessionId),
          eq(items.turnId, turnId),
          eq(items.id, `notices-${turnId}`),
        ),
      )
      .get();
    if (row?.data.kind !== "notice") return [];
    const batch = NoticeBatchData.safeParse(row.data.data);
    return batch.success ? batch.data.notices.map((n) => n.id) : [];
  }
}
