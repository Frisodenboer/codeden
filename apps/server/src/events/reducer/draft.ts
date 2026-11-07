import type { InboxItem, ItemRecord, Session, Thread, Usage } from "@codeden/contracts";
import { isOpenRequest } from "./items";
import type { Mutation, ProjectionReader, SessionRecord, TurnRecord } from "./types";

const key = (sessionId: string, id: string) => `${sessionId}\u0000${id}`;

/**
 * Overlay on a `ProjectionReader` that records writes, so one reducer step can read its own
 * changes. `mutations()` returns one mutation per changed entity, in first-write order.
 */
export class Draft implements ProjectionReader {
  private readonly order: string[] = [];
  private readonly sessions = new Map<string, SessionRecord & { changed: boolean }>();
  private readonly threads = new Map<string, Thread>();
  private readonly turns = new Map<string, TurnRecord>();
  private readonly items = new Map<string, ItemRecord>();
  private readonly inbox = new Map<string, { item: InboxItem; created: boolean }>();

  constructor(private readonly base: ProjectionReader) {}

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId) ?? this.base.getSession(sessionId);
  }

  getThread(sessionId: string, threadId: string): Thread | undefined {
    return this.threads.get(key(sessionId, threadId)) ?? this.base.getThread(sessionId, threadId);
  }

  getTurn(sessionId: string, turnId: string): TurnRecord | undefined {
    return this.turns.get(key(sessionId, turnId)) ?? this.base.getTurn(sessionId, turnId);
  }

  getItem(sessionId: string, itemId: string): ItemRecord | undefined {
    return this.items.get(key(sessionId, itemId)) ?? this.base.getItem(sessionId, itemId);
  }

  nextItemPosition(sessionId: string, threadId: string): number {
    let next = this.base.nextItemPosition(sessionId, threadId);
    for (const r of this.items.values()) {
      if (r.sessionId === sessionId && r.threadId === threadId) {
        next = Math.max(next, r.position + 1);
      }
    }
    return next;
  }

  openRequestItems(sessionId: string): ItemRecord[] {
    const byId = new Map(this.base.openRequestItems(sessionId).map((r) => [r.item.id, r]));
    for (const r of this.items.values()) {
      if (r.sessionId === sessionId) byId.set(r.item.id, r);
    }
    return [...byId.values()].filter((r) => isOpenRequest(r.item));
  }

  getInbox(inboxId: string): InboxItem | undefined {
    return this.inbox.get(inboxId)?.item ?? this.base.getInbox(inboxId);
  }

  openInboxForSession(sessionId: string): InboxItem[] {
    const byId = new Map(this.base.openInboxForSession(sessionId).map((i) => [i.id, i]));
    for (const { item } of this.inbox.values()) {
      if (item.sessionId === sessionId) byId.set(item.id, item);
    }
    return [...byId.values()].filter((i) => i.status === "open");
  }

  // ---------------------------------------------------------------- writes

  /** `changed: false` records a usage-only update. */
  putSession(session: Session, usage: Usage | null, changed = true): void {
    this.touch(`session:${session.id}`);
    const before = this.sessions.get(session.id)?.changed ?? false;
    this.sessions.set(session.id, { session, usage, changed: before || changed });
  }

  putThread(thread: Thread): void {
    const k = key(thread.sessionId, thread.id);
    this.touch(`thread:${k}`);
    this.threads.set(k, thread);
  }

  putTurn(turn: TurnRecord): void {
    const k = key(turn.sessionId, turn.id);
    this.touch(`turn:${k}`);
    this.turns.set(k, turn);
  }

  putItem(record: ItemRecord): void {
    const k = key(record.sessionId, record.item.id);
    this.touch(`item:${k}`);
    this.items.set(k, record);
  }

  putInbox(item: InboxItem): void {
    const existing = this.inbox.get(item.id);
    const created = existing ? existing.created : this.base.getInbox(item.id) === undefined;
    this.touch(`inbox:${item.id}`);
    this.inbox.set(item.id, { item, created });
  }

  mutations(): Mutation[] {
    const out: Mutation[] = [];
    for (const entry of this.order) {
      const sep = entry.indexOf(":");
      const kind = entry.slice(0, sep);
      const k = entry.slice(sep + 1);
      if (kind === "session") {
        const s = this.sessions.get(k);
        if (s) {
          out.push({
            type: "session",
            session: s.session,
            usage: s.usage,
            sessionChanged: s.changed,
          });
        }
      } else if (kind === "thread") {
        const t = this.threads.get(k);
        if (t) out.push({ type: "thread", thread: t });
      } else if (kind === "turn") {
        const t = this.turns.get(k);
        if (t) out.push({ type: "turn", turn: t });
      } else if (kind === "item") {
        const r = this.items.get(k);
        if (r) out.push({ type: "item", record: r });
      } else if (kind === "inbox") {
        const i = this.inbox.get(k);
        if (i) out.push({ type: "inbox", item: i.item, created: i.created });
      }
    }
    return out;
  }

  private touch(entry: string): void {
    if (!this.order.includes(entry)) this.order.push(entry);
  }
}
