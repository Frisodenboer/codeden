import type { InboxItem, InboxItemKind } from "@codeden/contracts";

/**
 * Inbox kinds that leave an agent blocked until the user acts. Only these chime, keep a sticky
 * toast and badge the favicon; every other kind is informational.
 */
export const BLOCKING_KINDS: ReadonlySet<InboxItemKind> = new Set(["approval", "question"]);

/** The item is an approval or a question (whatever its status). */
export function isBlockingKind(item: Pick<InboxItem, "kind">): boolean {
  return BLOCKING_KINDS.has(item.kind);
}

/** The item is an approval or a question that still waits on the user. */
export function isOpenBlocking(item: Pick<InboxItem, "kind" | "status">): boolean {
  return item.status === "open" && isBlockingKind(item);
}

/** Where "Open" goes for an item: its session when it has one, else the inbox. */
export type AttentionTarget =
  | { to: "/sessions/$sessionId"; params: { sessionId: string } }
  | { to: "/inbox" };

export function attentionTarget(item: Pick<InboxItem, "sessionId">): AttentionTarget {
  return item.sessionId
    ? { to: "/sessions/$sessionId", params: { sessionId: item.sessionId } }
    : { to: "/inbox" };
}
