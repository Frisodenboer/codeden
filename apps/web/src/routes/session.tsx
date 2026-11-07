import { MessageSquareDashed } from "lucide-react";
import { EmptyState } from "@/components/common/bits";
import { ThreadView } from "@/components/thread/thread-view";

/** Any agent or PM session. */
export function SessionPage({ sessionId }: { sessionId: string }) {
  return (
    <ThreadView
      key={sessionId}
      sessionId={sessionId}
      empty={
        <EmptyState icon={<MessageSquareDashed />} title="No messages yet" className="flex-1">
          Describe the task. The agent works in its own worktree and branch.
        </EmptyState>
      }
    />
  );
}
