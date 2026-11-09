import {
  READ_ALOUD_FULL_MAX_CHARS,
  READ_ALOUD_SUMMARY_MAX_CHARS,
  type SessionStatus,
  type Settings,
  type Snapshot,
  speechExcerpt,
} from "@codeden/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { CodeDenClient } from "@/lib/api";
import { platform } from "@/lib/platform";
import { snapshotKey } from "@/lib/queries";
import { onLiveEvent } from "@/lib/realtime";
import { type TranscriptState, transcriptFromSnapshot } from "@/lib/transcript/reducer";
import { finalAssistantText } from "@/lib/transcript/timeline";
import { useVoiceStore } from "@/stores/voice";
import { speak } from "./speak";
import { shouldReadAloud, stripForSpeech } from "./speech-text";

/** A session went from working to idle: its root turn just finished. */
export function turnJustFinished(prev: SessionStatus | undefined, next: SessionStatus): boolean {
  return (prev === "running" || prev === "waiting") && (next === "idle" || next === "completed");
}

/** The newest completed turn of the root thread, if the newest turn completed. */
export function latestCompletedRootTurn(state: TranscriptState): string | null {
  const turns = Object.values(state.turns)
    .filter((t) => t.threadId === state.rootThreadId)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const last = turns.at(-1);
  return last && last.status === "completed" ? last.id : null;
}

/**
 * What to speak for a final message (§11.3), following `voice.readAloud.content`. `full`: the
 * whole stripped message (capped). `summary`: short messages as they are, long ones as the
 * utility model's TL;DR, or their first sentence or two when that fails. Never the whole report.
 */
export async function readAloudText(
  client: Pick<CodeDenClient, "speechSummary">,
  settings: Settings,
  markdown: string,
): Promise<string> {
  const plain = stripForSpeech(markdown);
  if (settings.voice.readAloud.content === "full") {
    return speechExcerpt(plain, READ_ALOUD_FULL_MAX_CHARS);
  }
  if (plain.length <= READ_ALOUD_SUMMARY_MAX_CHARS) return plain;
  const short = (text: string) => speechExcerpt(text, READ_ALOUD_SUMMARY_MAX_CHARS, 2);
  try {
    const summary = (await client.speechSummary(markdown)).text.trim();
    return short(summary || plain);
  } catch (error) {
    console.warn("read-aloud: no TL;DR, speaking the first sentences", error);
    return short(plain);
  }
}

/**
 * Read-aloud for every session (§11.3), not only the one on screen: watches the domain event
 * stream for sessions whose turn just finished, loads that session's snapshot, and speaks its
 * final message (a TL;DR or the whole stripped message, per settings) with the configured
 * engine. Honours the global toggle, per-session mutes, quiet hours and "only when unfocused".
 */
export function startReadAloud(client: CodeDenClient, queryClient: QueryClient): () => void {
  const statuses = new Map<string, SessionStatus>();
  const spoken = new Set<string>();
  const seed = queryClient.getQueryData<Snapshot>(snapshotKey);
  for (const s of seed?.sessions ?? []) statuses.set(s.id, s.status);

  const settings = () => queryClient.getQueryData<Snapshot>(snapshotKey)?.settings;
  const allowed = (sessionId: string) => {
    const s = settings();
    return s
      ? shouldReadAloud(s, {
          now: new Date(),
          focused: platform.isFocused(),
          sessionMuted: Boolean(useVoiceStore.getState().muted[sessionId]),
        })
      : false;
  };

  const readFinished = async (sessionId: string) => {
    if (!allowed(sessionId)) return;
    const state = transcriptFromSnapshot(await client.getSessionSnapshot(sessionId));
    const turnId = latestCompletedRootTurn(state);
    if (!turnId || spoken.has(turnId)) return;
    spoken.add(turnId);
    const text = finalAssistantText(state, turnId);
    const s = settings();
    if (!text || !s) return;
    const spokenText = await readAloudText(client, s, text);
    if (spokenText && allowed(sessionId)) await speak(client, s, spokenText);
  };

  return onLiveEvent((env) => {
    if (env.type !== "session.created" && env.type !== "session.updated") return;
    const session = env.payload.session;
    const prev = statuses.get(session.id);
    statuses.set(session.id, session.status);
    if (env.type === "session.updated" && turnJustFinished(prev, session.status)) {
      void readFinished(session.id).catch(() => undefined);
    }
  });
}
