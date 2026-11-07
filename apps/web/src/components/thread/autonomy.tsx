import type { AutonomyLevel } from "@codeden/contracts";
import { type LucideIcon, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";

export const AUTONOMY: Record<
  AutonomyLevel,
  { label: string; short: string; description: string; icon: LucideIcon; tone: string }
> = {
  supervised: {
    label: "Supervised",
    short: "Supervised",
    description: "Every edit and command asks first.",
    icon: ShieldAlert,
    tone: "text-chart-2",
  },
  auto: {
    label: "Auto, risky actions ask",
    short: "Auto",
    description: "Edits and normal commands run freely; risky actions go to your inbox.",
    icon: ShieldCheck,
    tone: "text-status-done",
  },
  full: {
    label: "Full autonomy",
    short: "Full",
    description: "No approvals inside the worktree.",
    icon: ShieldOff,
    tone: "text-status-waiting",
  },
};

export function AutonomyBadge({ level, className }: { level: AutonomyLevel; className?: string }) {
  const a = AUTONOMY[level];
  return (
    <span
      title={a.description}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border border-border/80 px-2 text-2xs text-muted-foreground",
        className,
      )}
    >
      <a.icon className={cn("size-3", a.tone)} />
      {a.short}
    </span>
  );
}
