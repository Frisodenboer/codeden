import type { InboxItem, ItemRecord, Session, Thread, Turn, Usage } from "@codeden/contracts";

/** A turn row plus the usage reported for it. */
export interface TurnRecord extends Turn {
  usage: Usage | null;
}

/** A session row plus its accumulated usage (a server-side projection column). */
export interface SessionRecord {
  session: Session;
  usage: Usage | null;
}

/**
 * Read access to the current projections. The reducer only reads through this interface, so
 * it stays pure: the database implements it inside the append transaction, tests implement it
 * in memory.
 */
export interface ProjectionReader {
  getSession(sessionId: string): SessionRecord | undefined;
  getThread(sessionId: string, threadId: string): Thread | undefined;
  getTurn(sessionId: string, turnId: string): TurnRecord | undefined;
  getItem(sessionId: string, itemId: string): ItemRecord | undefined;
  /** Position for the next item appended to a thread. */
  nextItemPosition(sessionId: string, threadId: string): number;
  /** Approval requests and questions of a session still waiting on a response. */
  openRequestItems(sessionId: string): ItemRecord[];
  getInbox(inboxId: string): InboxItem | undefined;
  /** Open inbox items of a session. */
  openInboxForSession(sessionId: string): InboxItem[];
}

/**
 * A projection change produced by the reducer. Applying the list in order brings the
 * projections up to date with the event.
 */
export type Mutation =
  | { type: "thread"; thread: Thread }
  | { type: "turn"; turn: TurnRecord }
  | { type: "item"; record: ItemRecord }
  /** `sessionChanged` is false when only the usage projection changed. */
  | { type: "session"; session: Session; usage: Usage | null; sessionChanged: boolean }
  | { type: "inbox"; item: InboxItem; created: boolean };
