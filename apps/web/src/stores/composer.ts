import type { AutonomyLevel, ImageMediaType, ReasoningEffort } from "@codeden/contracts";
import { create } from "zustand";

export type ComposerAttachment =
  | {
      id: string;
      type: "image";
      name: string;
      mediaType: ImageMediaType;
      /** base64 without the data: prefix. */
      data: string;
      previewUrl: string;
    }
  | { id: string; type: "file"; name: string; path: string };

export interface Draft {
  text: string;
  attachments: ComposerAttachment[];
}

export interface TurnOptions {
  provider: string;
  model: string | null;
  effort: ReasoningEffort | null;
  autonomy: AutonomyLevel;
}

interface ComposerState {
  drafts: Record<string, Draft>;
  options: Record<string, TurnOptions>;
  /** Bumped when something outside the composer wants it focused. */
  focusToken: number;
  setText: (sessionId: string, text: string) => void;
  addAttachments: (sessionId: string, items: ComposerAttachment[]) => void;
  removeAttachment: (sessionId: string, id: string) => void;
  clear: (sessionId: string) => void;
  setOptions: (sessionId: string, options: Partial<TurnOptions>, fallback: TurnOptions) => void;
  focus: () => void;
}

const empty: Draft = { text: "", attachments: [] };

export function getDraft(state: { drafts: Record<string, Draft> }, sessionId: string): Draft {
  return state.drafts[sessionId] ?? empty;
}

/** Composer drafts and per-session turn options (provider, model, effort, autonomy). */
export const useComposerStore = create<ComposerState>()((set) => ({
  drafts: {},
  options: {},
  focusToken: 0,
  setText: (sessionId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...getDraft(s, sessionId), text } } })),
  addAttachments: (sessionId, items) =>
    set((s) => {
      const d = getDraft(s, sessionId);
      return {
        drafts: { ...s.drafts, [sessionId]: { ...d, attachments: [...d.attachments, ...items] } },
      };
    }),
  removeAttachment: (sessionId, id) =>
    set((s) => {
      const d = getDraft(s, sessionId);
      return {
        drafts: {
          ...s.drafts,
          [sessionId]: { ...d, attachments: d.attachments.filter((a) => a.id !== id) },
        },
      };
    }),
  clear: (sessionId) => set((s) => ({ drafts: { ...s.drafts, [sessionId]: empty } })),
  setOptions: (sessionId, options, fallback) =>
    set((s) => ({
      options: { ...s.options, [sessionId]: { ...(s.options[sessionId] ?? fallback), ...options } },
    })),
  focus: () => set((s) => ({ focusToken: s.focusToken + 1 })),
}));
