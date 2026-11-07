import {
  type EventEnvelope,
  EventEnvelope as EventEnvelopeSchema,
  isAgentEnvelope,
} from "@codeden/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@/stores/connection";
import { useTranscriptsStore } from "@/stores/transcripts";
import type { CodeDenClient } from "./api/client";
import { snapshotKey } from "./queries";
import { applyDomainEvent } from "./snapshot-reducer";

type EnvelopeListener = (env: EventEnvelope) => void;
const listeners = new Set<EnvelopeListener>();

/** Subscribe to every parsed live event (toasts, notifications, read-aloud). */
export function onLiveEvent(listener: EnvelopeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Realtime (§6): load the snapshot, subscribe from its seq, route agent events into the
 * transcript store and domain events into the snapshot cache; reload on `resync`.
 */
export function startRealtime(client: CodeDenClient, queryClient: QueryClient): () => void {
  const conn = useConnectionStore.getState;
  let unsubscribe: (() => void) | undefined;
  let stopped = false;
  conn().setSocket("connecting");

  const apply = (raw: unknown) => {
    const parsed = EventEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return; // Unknown event types are skipped (newer server).
    const env = parsed.data;
    if (isAgentEnvelope(env)) {
      useTranscriptsStore.getState().apply(env.sessionId, env.payload, env.seq, env.ts);
    } else {
      queryClient.setQueryData(
        snapshotKey,
        (s: Parameters<typeof applyDomainEvent>[0] | undefined) =>
          s ? applyDomainEvent(s, env) : s,
      );
    }
    conn().setSeq(env.seq);
    for (const l of listeners) l(env);
  };

  const connect = (fromSeq: number) => {
    unsubscribe = client.subscribe(fromSeq, (msg) => {
      switch (msg.type) {
        case "hello":
          conn().setSocket("open");
          break;
        case "runner":
          conn().setRunner(msg.runner);
          break;
        case "events":
          for (const e of msg.events) apply(e);
          break;
        case "resync":
          void queryClient.invalidateQueries();
          conn().setSeq(msg.seq);
          break;
        default:
          break;
      }
    });
  };

  queryClient
    .fetchQuery({ queryKey: snapshotKey, queryFn: () => client.getSnapshot() })
    .then((snap) => {
      if (stopped) return;
      conn().setSeq(snap.seq);
      conn().setRunner(snap.runner);
      connect(snap.seq);
    })
    .catch(() => conn().setSocket("closed"));

  return () => {
    stopped = true;
    unsubscribe?.();
  };
}
