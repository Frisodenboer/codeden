import type { FollowupSuggestion } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Composer } from "@/components/composer/composer";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { useSession, useSnapshotData, useTranscript } from "@/lib/queries";
import { activeTurn } from "@/lib/transcript/reducer";
import { latestFollowups } from "@/lib/transcript/timeline";
import { useComposerStore } from "@/stores/composer";
import { QueuedMessages } from "./queued-messages";
import { ThreadHeader } from "./thread-header";
import { Transcript } from "./transcript";

/** Follow-up suggestions as a list below the composer after a turn completes (§7.5); each can be dismissed. */
function FollowupChips({
  sessionId,
  suggestions,
}: {
  sessionId: string;
  suggestions: FollowupSuggestion[];
}) {
  const client = useClient();
  const sendOnClick = useSnapshotData((s) => s.settings.followups.sendOnClick, false);
  const setText = useComposerStore((s) => s.setText);
  const focus = useComposerStore((s) => s.focus);
  const send = useMutation({
    mutationFn: (prompt: string) => client.sendMessage(sessionId, { text: prompt }, "send"),
  });
  const [dismissed, setDismissed] = useState(
    () => dismissedFollowups.get(sessionId) ?? new Set<string>(),
  );
  const dismiss = (prompt: string) => {
    const next = new Set(dismissed).add(prompt);
    dismissedFollowups.set(sessionId, next);
    setDismissed(next);
  };
  const visible = suggestions.filter((s) => !dismissed.has(s.prompt));
  if (visible.length === 0) return null;
  return (
    <ul
      aria-label="Suggested follow-ups"
      className="mr-auto flex max-h-[30vh] w-full max-w-[46rem] shrink-0 flex-col gap-1 overflow-y-auto px-3 pb-3 scroll-thin sm:-mt-2 sm:px-6 sm:pb-4"
    >
      {visible.map((s) => (
        <li
          key={s.prompt}
          className="group flex items-center rounded-md border border-border bg-card/70 shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
        >
          <button
            type="button"
            title={s.prompt}
            onClick={() => {
              if (sendOnClick) send.mutate(s.prompt);
              else {
                setText(sessionId, s.prompt);
                focus();
              }
            }}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left text-xs text-muted-foreground group-hover:text-foreground"
          >
            <Sparkles className="size-3.5 shrink-0 text-primary/70" />
            <span className="truncate">{s.label ?? s.prompt}</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss suggestion"
            title="Dismiss"
            onClick={() => dismiss(s.prompt)}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Suggestions dismissed per session, kept while the app runs so they stay hidden when you switch sessions. */
const dismissedFollowups = new Map<string, Set<string>>();

function TranscriptSkeleton() {
  return (
    <div className="mr-auto w-full max-w-[46rem] space-y-5 px-6 pt-8">
      <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

/** The centre column for a session: header, transcript, follow-ups and composer. */
export function ThreadView({ sessionId, empty }: { sessionId: string; empty?: React.ReactNode }) {
  const session = useSession(sessionId);
  const { transcript, isLoading, error } = useTranscript(sessionId);
  const threadId = transcript?.rootThreadId ?? session?.rootThreadId ?? null;
  const running = Boolean(transcript && threadId && activeTurn(transcript, threadId));
  const followups = useMemo(
    () => (transcript && threadId ? latestFollowups(transcript, threadId) : null),
    [transcript, threadId],
  );
  const hasItems = Boolean(
    transcript && threadId && (transcript.threads[threadId]?.itemIds.length ?? 0) > 0,
  );

  if (!session) {
    return (
      <EmptyState icon={<Sparkles />} title="Session not found" className="flex-1">
        It may have been archived.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader session={session} running={running} />
      {error ? (
        <EmptyState icon={<Sparkles />} title="Couldn't load this session" className="flex-1">
          {error.message}
        </EmptyState>
      ) : isLoading || !transcript || !threadId ? (
        <div className="flex-1">
          <TranscriptSkeleton />
        </div>
      ) : hasItems ? (
        <Transcript transcript={transcript} threadId={threadId} sessionId={sessionId} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{empty}</div>
      )}
      <QueuedMessages session={session} running={running} />
      <Composer session={session} running={running} />
      {followups && !running && <FollowupChips sessionId={sessionId} suggestions={followups} />}
    </div>
  );
}
