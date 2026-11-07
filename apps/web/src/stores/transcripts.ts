import type { AgentEvent, SessionSnapshot, TranscriptMessage } from "@codeden/contracts";
import { create } from "zustand";
import { applyTranscriptMessage } from "@/lib/transcript/apply-transcript";
import {
  applyAgentEvent,
  type TranscriptState,
  transcriptFromSnapshot,
} from "@/lib/transcript/reducer";

/** A root-thread turn that just finished (read-aloud, notifications). */
export interface TurnFinished {
  sessionId: string;
  turnId: string;
  status: "completed" | "failed" | "interrupted";
}

type TurnListener = (event: TurnFinished) => void;
const turnListeners = new Set<TurnListener>();

/** Be told when a root-thread turn of a loaded transcript finishes. */
export function onTurnFinished(listener: TurnListener): () => void {
  turnListeners.add(listener);
  return () => turnListeners.delete(listener);
}

function finishedTurns(prev: TranscriptState, next: TranscriptState): TurnFinished[] {
  const out: TurnFinished[] = [];
  for (const turn of Object.values(next.turns)) {
    if (turn.threadId !== next.rootThreadId || turn.status === "running") continue;
    if (prev.turns[turn.id]?.status !== "running") continue;
    out.push({ sessionId: next.sessionId, turnId: turn.id, status: turn.status });
  }
  return out;
}

interface TranscriptsState {
  byId: Record<string, TranscriptState>;
  /**
   * Load (or refresh) a session from its snapshot. Never goes backwards in seq unless
   * `replace` is set (after a `transcript_resync`).
   */
  load: (snap: SessionSnapshot, opts?: { replace?: boolean }) => void;
  /** Apply a live agent event. Ignored for sessions not loaded or already past `seq`. */
  apply: (sessionId: string, event: AgentEvent, seq: number, ts: string) => void;
  /** Apply a `transcript` message from a session watch. */
  applyTranscript: (msg: TranscriptMessage) => void;
}

/** Live transcripts of the sessions the user has opened. */
export const useTranscriptsStore = create<TranscriptsState>()((set, get) => ({
  byId: {},
  load: (snap, opts) =>
    set((s) => {
      const existing = s.byId[snap.session.id];
      if (existing && existing.seq >= snap.seq && !opts?.replace) return s;
      return { byId: { ...s.byId, [snap.session.id]: transcriptFromSnapshot(snap) } };
    }),
  apply: (sessionId, event, seq, ts) => {
    const existing = get().byId[sessionId];
    if (!existing || seq <= existing.seq) return;
    const next = applyAgentEvent(existing, event, { seq, ts });
    set((s) => ({ byId: { ...s.byId, [sessionId]: next } }));
    for (const f of finishedTurns(existing, next)) for (const l of turnListeners) l(f);
  },
  applyTranscript: (msg) => {
    const existing = get().byId[msg.sessionId];
    if (!existing) return;
    const next = applyTranscriptMessage(existing, msg);
    set((s) => ({ byId: { ...s.byId, [msg.sessionId]: next } }));
    for (const f of finishedTurns(existing, next)) for (const l of turnListeners) l(f);
  },
}));
