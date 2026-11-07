import type { AgentEvent, SessionSnapshot } from "@codeden/contracts";
import { create } from "zustand";
import {
  applyAgentEvent,
  type TranscriptState,
  transcriptFromSnapshot,
} from "@/lib/transcript/reducer";

interface TranscriptsState {
  byId: Record<string, TranscriptState>;
  /** Load (or refresh) a session from its snapshot; never goes backwards in seq. */
  load: (snap: SessionSnapshot) => void;
  /** Apply a live agent event. Ignored for sessions not loaded or already past `seq`. */
  apply: (sessionId: string, event: AgentEvent, seq: number, ts: string) => void;
}

/** Live transcripts of the sessions the user has opened. */
export const useTranscriptsStore = create<TranscriptsState>()((set) => ({
  byId: {},
  load: (snap) =>
    set((s) => {
      const existing = s.byId[snap.session.id];
      if (existing && existing.seq >= snap.seq) return s;
      return { byId: { ...s.byId, [snap.session.id]: transcriptFromSnapshot(snap) } };
    }),
  apply: (sessionId, event, seq, ts) =>
    set((s) => {
      const existing = s.byId[sessionId];
      if (!existing || seq <= existing.seq) return s;
      return { byId: { ...s.byId, [sessionId]: applyAgentEvent(existing, event, { seq, ts }) } };
    }),
}));
