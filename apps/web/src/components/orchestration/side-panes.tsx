import { FollowUpsCard } from "./follow-ups-card";
import { IdeaBoard } from "./idea-board";
import { ScheduledCard } from "./scheduled-card";

/**
 * The Scheduled card, Follow-ups and the idea board, top right of the orchestrator and PM
 * screens. Shown only where the left-aligned chat leaves room for them.
 */
export function SidePanes({ projectId = null }: { projectId?: string | null }) {
  return (
    <div className="absolute top-14 right-4 bottom-4 z-10 hidden w-[24rem] flex-col gap-3 overflow-y-auto scroll-thin min-[1600px]:flex">
      <ScheduledCard className="shrink-0" />
      <FollowUpsCard className="shrink-0" />
      <IdeaBoard className="shrink-0" projectId={projectId} />
    </div>
  );
}
