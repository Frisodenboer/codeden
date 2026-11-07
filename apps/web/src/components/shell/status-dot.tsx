import type { SessionStatus } from "@codeden/contracts";
import { cn } from "@/lib/utils";

type Tone = "running" | "waiting" | "done" | "failed" | "idle";

const toneFor: Record<SessionStatus, Tone> = {
  created: "idle",
  queued: "idle",
  starting: "running",
  running: "running",
  waiting: "waiting",
  idle: "idle",
  interrupted: "waiting",
  completed: "done",
  failed: "failed",
  stopped: "idle",
};

const toneClass: Record<Tone, string> = {
  running: "bg-status-running shadow-[0_0_0_3px] shadow-status-running/20 animate-pulse",
  waiting: "bg-status-waiting shadow-[0_0_0_3px] shadow-status-waiting/20",
  done: "bg-status-done",
  failed: "bg-status-failed",
  idle: "bg-status-idle",
};

/** Session status dot (running, waiting on you, done, failed). */
export function StatusDot({ status, tone }: { status?: SessionStatus; tone?: Tone }) {
  const t = tone ?? (status ? toneFor[status] : "idle");
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", toneClass[t])} />;
}
