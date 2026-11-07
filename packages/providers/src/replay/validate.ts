import { AgentEvent } from "@codeden/contracts";

/**
 * Check a complete normalized event stream against the event-model rules (§7.3) beyond what
 * the zod schemas enforce. Returns human-readable problems; empty means valid. Used by the
 * adapter contract tests on recorded fixtures.
 */
export function validateEventStream(events: readonly unknown[]): string[] {
  const problems: string[] = [];
  const threads = new Map<string, { parent?: string; parentItem?: string }>();
  const turns = new Map<string, "open" | "done">();
  const items = new Map<string, { kind: string; done: boolean; childThreadId?: string }>();
  let openRootTurn: string | undefined;
  let rootThread: string | undefined;

  events.forEach((raw, i) => {
    const parsed = AgentEvent.safeParse(raw);
    if (!parsed.success) {
      problems.push(`#${i}: does not match AgentEvent: ${parsed.error.message.slice(0, 200)}`);
      return;
    }
    const e = parsed.data;
    const at = `#${i} ${e.type}`;
    if (i === 0 && e.type !== "thread.started")
      problems.push(`${at}: stream must start with thread.started`);
    if (e.type === "thread.started") {
      if (threads.has(e.thread.id)) problems.push(`${at}: thread ${e.thread.id} started twice`);
      if (!e.thread.parentThreadId) rootThread ??= e.thread.id;
      else if (!threads.has(e.thread.parentThreadId)) problems.push(`${at}: unknown parent thread`);
      threads.set(e.thread.id, {
        parent: e.thread.parentThreadId,
        parentItem: e.thread.parentItemId,
      });
      return;
    }
    if (e.type === "session.updated") return;
    if (!threads.has(e.threadId)) {
      problems.push(`${at}: unknown thread ${e.threadId}`);
      return;
    }
    if (e.type === "usage.updated") return;
    const key = `${e.threadId}/${e.turnId}`;
    if (e.type === "turn.started") {
      if (turns.has(key)) problems.push(`${at}: turn ${e.turnId} started twice`);
      turns.set(key, "open");
      if (e.threadId === rootThread) {
        if (openRootTurn) problems.push(`${at}: root turn started while ${openRootTurn} is open`);
        openRootTurn = e.turnId;
      }
      return;
    }
    const turn = turns.get(key);
    if (!turn) {
      problems.push(`${at}: turn ${e.turnId} was never started`);
      return;
    }
    if (e.type === "turn.completed" || e.type === "turn.failed" || e.type === "turn.interrupted") {
      if (turn === "done") problems.push(`${at}: turn ${e.turnId} ended twice`);
      turns.set(key, "done");
      if (e.threadId === rootThread && openRootTurn === e.turnId) openRootTurn = undefined;
      return;
    }
    if (e.type === "item.delta") {
      const item = items.get(e.itemId);
      if (!item) problems.push(`${at}: delta for unknown item ${e.itemId}`);
      else if (item.done) problems.push(`${at}: delta after item ${e.itemId} completed`);
      return;
    }
    const item = e.item;
    if (turn === "done" && item.kind !== "subagent") {
      problems.push(`${at}: ${item.kind} item ${item.id} after turn ${e.turnId} ended`);
    }
    const existing = items.get(item.id);
    if (e.type === "item.started") {
      if (existing) problems.push(`${at}: item ${item.id} started twice`);
      if (item.status !== "in_progress" && item.kind !== "user_message" && item.kind !== "notice") {
        problems.push(`${at}: started item ${item.id} is ${item.status}`);
      }
    } else if (e.type === "item.updated") {
      if (!existing) problems.push(`${at}: update for unknown item ${item.id}`);
      else if (existing.done) problems.push(`${at}: update after item ${item.id} completed`);
    } else {
      if (existing?.done) problems.push(`${at}: item ${item.id} completed twice`);
      if (item.status === "in_progress")
        problems.push(`${at}: completed item ${item.id} is in_progress`);
    }
    items.set(item.id, {
      kind: item.kind,
      done: e.type === "item.completed",
      ...(item.kind === "subagent" ? { childThreadId: item.childThreadId } : {}),
    });
  });

  for (const [id, item] of items)
    if (!item.done) problems.push(`item ${id} (${item.kind}) never completed`);
  for (const [key, state] of turns) if (state === "open") problems.push(`turn ${key} never ended`);
  for (const [id, thread] of threads) {
    if (!thread.parent) continue;
    const item = thread.parentItem ? items.get(thread.parentItem) : undefined;
    if (item?.kind !== "subagent" || item.childThreadId !== id) {
      problems.push(`thread ${id} has no matching subagent item in its parent`);
    }
  }
  return problems;
}
