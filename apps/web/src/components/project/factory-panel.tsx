import type { FactoryLoopState } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Factory, FileText, Power } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { compact, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BacklogColumn, ChecksColumn, RecentColumn } from "./factory-columns";

const STAGES: { id: FactoryLoopState | "merge"; label: string }[] = [
  { id: "discovering", label: "Discover" },
  { id: "building", label: "Build" },
  { id: "verifying", label: "Verify" },
  { id: "merge", label: "Merge & watch" },
];

function Meter({
  label,
  value,
  max,
  display,
  warn = true,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  warn?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xs tracking-wider text-muted-foreground uppercase">{label}</span>
        <span className="text-[13px] font-medium tabular-nums">{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            !warn
              ? "bg-status-running"
              : pct > 85
                ? "bg-status-failed"
                : pct > 60
                  ? "bg-status-waiting"
                  : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Factory panel for autopilot and dark-factory projects (§10.1). */
export function FactoryPanel({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const { data: f } = useQuery({
    queryKey: ["factory", projectId],
    queryFn: () => client.getFactoryStatus(projectId),
  });
  const kill = useMutation({
    mutationFn: (on: boolean) => client.setKillSwitch({ projectId }, on),
    onSuccess: (_d, on) => {
      void queryClient.invalidateQueries({ queryKey: ["factory", projectId] });
      toast[on ? "warning" : "success"](
        on ? "Factory stopped — all its sessions were halted" : "Factory loop resumed",
      );
    },
  });

  if (!f) return <Skeleton className="h-72 w-full rounded-xl" />;
  const stopped = f.killSwitch || f.loopState === "stopped";
  const active = STAGES.findIndex((s) => s.id === f.loopState);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Factory className="size-4" />
        </span>
        <div>
          <div className="flex items-center gap-2 text-[14px] font-medium">
            {f.mode === "dark_factory" ? "Dark factory" : "Autopilot"}
            <span className="rounded-full border border-primary/30 px-1.5 py-px text-3xs font-normal text-primary">
              experimental
            </span>
          </div>
          <div className="text-2xs text-muted-foreground">
            The PM finds work from the vision; CodeDen merges when every check passes.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" asChild>
            <Link to="/projects/$projectId/vision" params={{ projectId }}>
              <FileText /> Vision
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant={stopped ? "outline" : "destructive"}>
                <Power /> {stopped ? "Resume loop" : "Kill switch"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {stopped ? "Resume the factory loop?" : "Stop the factory now?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {stopped
                    ? "The PM will start picking up backlog items again, within your limits."
                    : "This stops the loop and every factory session in this project immediately. Open PRs stay open."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => kill.mutate(!stopped)}
                  variant={stopped ? "default" : "destructive"}
                >
                  {stopped ? "Resume" : "Stop everything"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center gap-1.5">
          {STAGES.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center gap-1.5">
              <div
                className={cn(
                  "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border text-2xs",
                  stopped
                    ? "border-border text-muted-foreground/60"
                    : i === active
                      ? "border-primary/50 bg-primary/10 font-medium text-primary"
                      : i < active
                        ? "border-border text-foreground/70"
                        : "border-dashed border-border text-muted-foreground",
                )}
              >
                {i === active && !stopped && (
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                )}
                {s.label}
              </div>
              {i < STAGES.length - 1 && <span className="h-px w-2 bg-border" />}
            </div>
          ))}
          <span
            className={cn(
              "ml-2 shrink-0 rounded-full px-2 py-0.5 text-3xs font-medium",
              stopped
                ? "bg-status-failed/12 text-status-failed"
                : "bg-status-running/12 text-status-running",
            )}
          >
            {stopped ? "Stopped" : `Loop ${f.loopState}`}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Meter
            label="Spend today"
            value={f.spendToday.usd}
            max={f.limits.dailyBudget.usd ?? 0}
            display={`${usd(f.spendToday.usd)} / ${usd(f.limits.dailyBudget.usd ?? 0)}`}
          />
          <Meter
            label="Merges today"
            value={f.mergesToday}
            max={f.limits.maxMergesPerDay}
            display={`${f.mergesToday} / ${f.limits.maxMergesPerDay}`}
            warn={false}
          />
          <Meter
            label="Sessions"
            value={f.inProgress.length}
            max={f.limits.maxConcurrentSessions}
            display={`${f.inProgress.length} / ${f.limits.maxConcurrentSessions}`}
            warn={false}
          />
          <Meter
            label="Failures in a row"
            value={f.consecutiveFailures}
            max={f.limits.pauseAfterConsecutiveFailures}
            display={`${f.consecutiveFailures} / ${f.limits.pauseAfterConsecutiveFailures}`}
          />
        </div>
        <p className="text-3xs text-muted-foreground/80">
          {compact(f.spendToday.tokens)} tokens today · protected:{" "}
          {f.limits.protectedPaths.join(", ") || "none"} · deploys{" "}
          {f.limits.allowDeploys ? "allowed" : "off"}
        </p>

        <div className="grid gap-3 lg:grid-cols-3">
          <BacklogColumn backlog={f.backlog} inProgress={f.inProgress} />
          <ChecksColumn checks={f.mergeChecks} />
          <RecentColumn recent={f.recent} />
        </div>
      </div>
    </section>
  );
}
