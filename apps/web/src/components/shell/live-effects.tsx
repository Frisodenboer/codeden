import type { Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { platform } from "@/lib/platform";
import { snapshotKey, useSnapshot } from "@/lib/queries";
import { onLiveEvent } from "@/lib/realtime";
import { finalAssistantText } from "@/lib/transcript/timeline";
import { tts } from "@/lib/voice/engines";
import { shouldReadAloud, stripForSpeech } from "@/lib/voice/speech-text";
import { onTurnFinished, useTranscriptsStore } from "@/stores/transcripts";

const inboxVerb: Record<string, string> = {
  approval: "Approval needed",
  question: "Question from an agent",
  pr_review: "PR ready for review",
  run_failed: "Run failed",
  triage: "Triage decision",
  automation_result: "Automation result",
  message: "Message",
};

/**
 * Side effects of live events: toasts and browser notifications for new inbox items, the
 * unread badge, and read-aloud of the final message when a turn completes (§11.1, §11.3).
 */
export function LiveEffects() {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSnapshot();
  const openCount = data?.inbox.filter((i) => i.status === "open").length ?? 0;
  const lastStatus = useRef(new Map<string, string>());

  useEffect(() => platform.setBadge(openCount), [openCount]);

  useEffect(() => {
    return onLiveEvent((env) => {
      const snap = queryClient.getQueryData<Snapshot>(snapshotKey);
      if (!snap) return;
      if (env.type === "inbox.created") {
        const item = env.payload.item;
        if (snap.settings.notifications.toasts) {
          toast(inboxVerb[item.kind] ?? "Inbox", {
            description: item.title,
            action: { label: "Open", onClick: () => void navigate({ to: "/inbox" }) },
          });
        }
        if (snap.settings.notifications.browser && !platform.isFocused()) {
          platform.notify(inboxVerb[item.kind] ?? "CodeDen", {
            body: item.title,
            tag: item.id,
            onClick: () => void navigate({ to: "/inbox" }),
          });
        }
      }
      if (env.type === "session.updated") {
        const s = env.payload.session;
        const prev = lastStatus.current.get(s.id);
        lastStatus.current.set(s.id, s.status);
        if (
          prev &&
          prev !== "failed" &&
          s.status === "failed" &&
          snap.settings.notifications.toasts
        ) {
          toast.error(`${s.title ?? s.purpose} failed`, {
            action: {
              label: "Open",
              onClick: () =>
                void navigate({ to: "/sessions/$sessionId", params: { sessionId: s.id } }),
            },
          });
        }
      }
    });
  }, [queryClient, navigate]);

  // Read the final message aloud when a turn completes (§11.3), compressed by the utility model.
  useEffect(() => {
    return onTurnFinished(async ({ sessionId, turnId, status }) => {
      if (status !== "completed") return;
      const snap = queryClient.getQueryData<Snapshot>(snapshotKey);
      if (!snap) return;
      if (!shouldReadAloud(snap.settings, { now: new Date(), focused: platform.isFocused() }))
        return;
      const transcript = useTranscriptsStore.getState().byId[sessionId];
      const text = transcript ? finalAssistantText(transcript, turnId) : null;
      if (!text) return;
      const plain = stripForSpeech(text);
      let spoken = plain;
      if (plain.length > 280 && snap.settings.utilityModel.jobs.readAloudSummary) {
        spoken = await client
          .speechSummary(text)
          .then((r) => r.text)
          .catch(() => plain);
      }
      tts.speak(spoken, { voice: snap.settings.voice.readAloud.voice });
    });
  }, [client, queryClient]);

  return null;
}
