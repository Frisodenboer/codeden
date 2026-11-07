import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VoiceState {
  /** Sessions whose finished turns are never read aloud (per-session toggle, §11.3). */
  muted: Record<string, true>;
  setMuted: (sessionId: string, muted: boolean) => void;
}

/** Per-session read-aloud mutes, persisted per browser. */
export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      muted: {},
      setMuted: (sessionId, muted) =>
        set((s) => {
          const next = { ...s.muted };
          if (muted) next[sessionId] = true;
          else delete next[sessionId];
          return { muted: next };
        }),
    }),
    { name: "codeden.voice" },
  ),
);
