import type { ItemDelta, RawEventEnvelope } from "@codeden/contracts";

interface DeltaPayload {
  type: "item.delta";
  threadId: string;
  turnId: string;
  itemId: string;
  delta: ItemDelta;
}

function asDelta(e: RawEventEnvelope): DeltaPayload | undefined {
  return e.type === "agent.item.delta" ? (e.payload as DeltaPayload) : undefined;
}

function deltaText(d: ItemDelta): string {
  return d.type === "tool_input" ? d.partialJson : d.text;
}

function mergeable(a: DeltaPayload, b: DeltaPayload): boolean {
  if (a.itemId !== b.itemId || a.turnId !== b.turnId || a.threadId !== b.threadId) return false;
  if (a.delta.type !== b.delta.type) return false;
  if (a.delta.type === "tool_output" && b.delta.type === "tool_output") {
    return a.delta.stream === b.delta.stream;
  }
  return true;
}

function withText(d: ItemDelta, text: string): ItemDelta {
  return d.type === "tool_input" ? { ...d, partialJson: text } : { ...d, text };
}

/**
 * Merge runs of consecutive text deltas for the same item into one event carrying the last
 * seq and timestamp, so a burst of streamed tokens reaches the UI as one update. Order is
 * preserved and every other event passes through untouched. Pure.
 */
export function coalesceEvents(events: RawEventEnvelope[]): RawEventEnvelope[] {
  const out: RawEventEnvelope[] = [];
  for (const event of events) {
    const prev = out.at(-1);
    const a = prev ? asDelta(prev) : undefined;
    const b = asDelta(event);
    if (prev && a && b && prev.sessionId === event.sessionId && mergeable(a, b)) {
      const merged: DeltaPayload = {
        ...b,
        delta: withText(b.delta, deltaText(a.delta) + deltaText(b.delta)),
      };
      out[out.length - 1] = { ...event, payload: merged };
      continue;
    }
    out.push(event);
  }
  return out;
}
