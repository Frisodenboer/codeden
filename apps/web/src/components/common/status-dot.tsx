import type { SessionStatus } from "@codeden/contracts";
import { statusTone, type Tone } from "@/lib/format";
import { cn } from "@/lib/utils";

const toneClass: Record<Tone, string> = {
  running: "bg-status-running",
  waiting: "bg-status-waiting",
  done: "bg-status-done",
  failed: "bg-status-failed",
  idle: "bg-status-idle/70",
};

/** Session status dot: running pulses with a soft halo, waiting gets a steady ring. */
export function StatusDot({
  status,
  tone,
  className,
}: {
  status?: SessionStatus;
  tone?: Tone;
  className?: string;
}) {
  const t = tone ?? (status ? statusTone[status] : "idle");
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {t === "running" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-status-running/60 [animation-duration:1.8s]" />
      )}
      <span
        className={cn(
          "relative inline-block size-2 rounded-full",
          toneClass[t],
          t === "waiting" && "ring-[3px] ring-status-waiting/20",
        )}
      />
    </span>
  );
}
