import {
  type AgentEventOf,
  agentEventToNewEvent,
  type RawEventEnvelope,
  type Session,
} from "@codeden/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToItemRecord } from "../../db/rows";
import { items } from "../../db/schema";
import type { EventStore } from "../../events/store";
import type { SettingsStore } from "../../settings-store";
import { errorMessage } from "../errors";
import type { UtilityService } from "../utility";
import { findConflicts } from "./conflicts";
import type { SessionRepo } from "./repo";
import type { SessionService } from "./session-service";

export interface LifecycleDeps {
  db: Db;
  store: EventStore;
  repo: SessionRepo;
  sessions: SessionService;
  settings: SettingsStore;
  utility: UtilityService;
  log?: (message: string) => void;
}

/**
 * Reacts to committed events: starts queued sessions whose blockers finished (§8.4 `wait`),
 * sends queued messages when a session goes idle, and runs utility-model hooks after a root
 * turn completes. Work is deferred so it never appends inside a store notification.
 */
export class SessionLifecycle {
  private drainScheduled = false;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: LifecycleDeps) {}

  start(): void {
    this.unsubscribe = this.deps.store.subscribe((events) => this.onEvents(events));
    this.scheduleDrain();
  }

  stop(): void {
    this.unsubscribe?.();
  }

  /** Start every queued session that no longer conflicts with earlier work. */
  drainQueue(): void {
    const queued = this.deps.repo.queued();
    queued.forEach((session, index) => {
      const later = new Set(queued.slice(index + 1).map((s) => s.id));
      const others = this.deps.repo
        .activeWork(session.projectId)
        .filter((w) => w.id !== session.id && !later.has(w.id));
      const blockers = findConflicts({ workKey: session.workKey, scope: session.scope }, others);
      if (blockers.length === 0) this.deps.sessions.startQueued(session);
    });
  }

  private onEvents(events: RawEventEnvelope[]): void {
    let sessionsChanged = false;
    for (const e of events) {
      if (e.type === "session.created" || e.type === "session.updated") {
        sessionsChanged = true;
        const { session } = e.payload as { session: Session };
        if (session.status === "idle" && this.deps.sessions.hasOutbox(session.id)) {
          setImmediate(() => void this.deps.sessions.flushOutbox(session.id));
        }
      } else if (e.type === "agent.turn.completed" && e.sessionId) {
        const sessionId = e.sessionId;
        const event = e.payload as AgentEventOf<"turn.completed">;
        setImmediate(() => void this.afterTurn(sessionId, event));
      }
    }
    if (sessionsChanged) this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      try {
        this.drainQueue();
      } catch (error) {
        this.deps.log?.(`queue: ${errorMessage(error)}`);
      }
    });
  }

  /** Utility-model hooks (§7.4, §7.5); no-ops with the default `UtilityService`. */
  private async afterTurn(sessionId: string, event: AgentEventOf<"turn.completed">): Promise<void> {
    try {
      const session = this.deps.repo.find(sessionId)?.session;
      if (!session || session.rootThreadId !== event.threadId) return;
      const settings = this.deps.settings.get();
      const turnItems = this.deps.db
        .select()
        .from(items)
        .where(and(eq(items.sessionId, sessionId), eq(items.turnId, event.turnId)))
        .orderBy(desc(items.position))
        .all()
        .map(rowToItemRecord);
      const final = turnItems.find((r) => r.item.kind === "assistant_message")?.item;
      const ctx = {
        session,
        finalMessage: final?.kind === "assistant_message" ? final.text : null,
      };

      if (!session.title && settings.utilityModel.jobs.sessionTitles) {
        const title = await this.deps.utility.sessionTitle(ctx);
        if (title) this.deps.repo.update(sessionId, (s) => (s.title ? s : { ...s, title }));
      }
      const hasFollowups = turnItems.some((r) => r.item.kind === "followups");
      if (!hasFollowups && settings.followups.enabled && settings.utilityModel.jobs.followups) {
        const suggestions = await this.deps.utility.suggestFollowups(ctx);
        if (suggestions && suggestions.length > 0) {
          this.deps.store.append([
            agentEventToNewEvent(sessionId, {
              type: "item.completed",
              threadId: event.threadId,
              turnId: event.turnId,
              item: {
                id: `followups-${event.turnId}`,
                kind: "followups",
                status: "completed",
                source: "utility",
                suggestions: suggestions.slice(0, 4),
              },
            }),
          ]);
        }
      }
    } catch (error) {
      this.deps.log?.(`utility hooks: ${errorMessage(error)}`);
    }
  }
}
