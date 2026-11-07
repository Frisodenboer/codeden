import type {
  AgentEvent,
  InboxItem,
  ItemRecord,
  RunnerEvent,
  Session,
  Thread,
  Usage,
} from "@codeden/contracts";
import { reduceAgentEvent } from "../../src/events/reducer/agent";
import { isOpenRequest } from "../../src/events/reducer/items";
import { reduceProcessEvent } from "../../src/events/reducer/process";
import type {
  Mutation,
  ProjectionReader,
  SessionRecord,
  TurnRecord,
} from "../../src/events/reducer/types";

const k = (a: string, b: string) => `${a}/${b}`;

/** In-memory projections driven by the pure reducer, for unit tests. */
export class MemoryProjection implements ProjectionReader {
  sessions = new Map<string, SessionRecord>();
  threads = new Map<string, Thread>();
  turns = new Map<string, TurnRecord>();
  items = new Map<string, ItemRecord>();
  inbox = new Map<string, InboxItem>();
  /** Every mutation applied, in order. */
  log: Mutation[] = [];
  private clock = 0;

  addSession(session: Session, usage: Usage | null = null): void {
    this.sessions.set(session.id, { session, usage });
  }

  /** Apply agent events for a session; returns the mutations of the last event. */
  apply(sessionId: string, ...events: AgentEvent[]): Mutation[] {
    let last: Mutation[] = [];
    for (const event of events) {
      last = reduceAgentEvent(this, sessionId, event, this.tick());
      this.commit(last);
    }
    return last;
  }

  applyProcess(event: Extract<RunnerEvent, { kind: "session.process" }>, seq: number): Mutation[] {
    const mutations = reduceProcessEvent(this, event, seq, this.tick());
    this.commit(mutations);
    return mutations;
  }

  session(id = "s1"): Session {
    const s = this.sessions.get(id)?.session;
    if (!s) throw new Error(`no session ${id}`);
    return s;
  }

  usage(id = "s1"): Usage | null {
    return this.sessions.get(id)?.usage ?? null;
  }

  item(itemId: string, sessionId = "s1"): ItemRecord | undefined {
    return this.items.get(k(sessionId, itemId));
  }

  turn(turnId: string, sessionId = "s1"): TurnRecord | undefined {
    return this.turns.get(k(sessionId, turnId));
  }

  // ---------------------------------------------------------------- ProjectionReader

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }
  getThread(sessionId: string, threadId: string): Thread | undefined {
    return this.threads.get(k(sessionId, threadId));
  }
  getTurn(sessionId: string, turnId: string): TurnRecord | undefined {
    return this.turns.get(k(sessionId, turnId));
  }
  getItem(sessionId: string, itemId: string): ItemRecord | undefined {
    return this.items.get(k(sessionId, itemId));
  }
  nextItemPosition(sessionId: string, threadId: string): number {
    let next = 0;
    for (const r of this.items.values()) {
      if (r.sessionId === sessionId && r.threadId === threadId)
        next = Math.max(next, r.position + 1);
    }
    return next;
  }
  openRequestItems(sessionId: string): ItemRecord[] {
    return [...this.items.values()].filter(
      (r) => r.sessionId === sessionId && isOpenRequest(r.item),
    );
  }
  getInbox(inboxId: string): InboxItem | undefined {
    return this.inbox.get(inboxId);
  }
  openInboxForSession(sessionId: string): InboxItem[] {
    return [...this.inbox.values()].filter((i) => i.sessionId === sessionId && i.status === "open");
  }

  private commit(mutations: Mutation[]): void {
    for (const m of mutations) {
      this.log.push(m);
      if (m.type === "session")
        this.sessions.set(m.session.id, { session: m.session, usage: m.usage });
      else if (m.type === "thread") this.threads.set(k(m.thread.sessionId, m.thread.id), m.thread);
      else if (m.type === "turn") this.turns.set(k(m.turn.sessionId, m.turn.id), m.turn);
      else if (m.type === "item") this.items.set(k(m.record.sessionId, m.record.item.id), m.record);
      else this.inbox.set(m.item.id, m.item);
    }
  }

  private tick(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 10, 7, 10, 0, this.clock)).toISOString();
  }
}
