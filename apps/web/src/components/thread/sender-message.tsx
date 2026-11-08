import type { RoleSender } from "@codeden/contracts";
import { RoleBadge } from "@/components/orchestration/role-badge";
import { usePrefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

const senderName: Record<RoleSender, string> = {
  pm: "the project manager",
  orchestrator: "the orchestrator",
};

/**
 * A message from the project's PM or the orchestrator: rendered Markdown in a card with the
 * sender's role badge, a thin primary border and a slow light along it (still under reduced
 * motion).
 */
export function SenderMessage({ from, text }: { from: RoleSender; text: string }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <article
      aria-label={`Message from ${senderName[from]}`}
      data-testid="sender-message"
      data-sender={from}
      className={cn(
        "border-shimmer max-w-[80%] min-w-0 rounded-2xl rounded-br-md bg-primary/[0.035] px-3.5 pt-2 pb-2.5",
        !reducedMotion && "animate-border-shimmer",
      )}
    >
      <header className="mb-1.5 flex">
        <RoleBadge role={from} />
      </header>
      {text && <Markdown>{text}</Markdown>}
    </article>
  );
}
