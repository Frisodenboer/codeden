import type { FactoryLoopState, FactoryStatus, Project } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Factory,
  FileText,
  Newspaper,
  Play,
  SlidersHorizontal,
  StepForward,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { factoryKeys, useFactoryStatus } from "@/lib/factory";
import { ago, compact, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AutonomyDialog, ExperimentalBadge } from "./autonomy-dialog";
import { BacklogColumn, ChecksColumn, RecentColumn } from "./factory-columns";
import { KillSwitchButton } from "./kill-switch";
import { LOOP_LABEL, MODE_LABEL } from "./meta";

const STAGES: { id: FactoryLoopState | "merge"; label: string }[] = [
  { id: "discovering", label: "Discover" },
  { id: "building", label: "Build" },
  { id: "verifying", label: "Verify" },
  { id: "merge", label: "Merge & watch" },
];

function Meter(props: {
  label: string;
  value: number;
  max: number;
  display: string;
  warn?: boolean;
}) {
  const { label, value, max, display, warn = true } = props;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bar = !warn
    ? "bg-status-running"
    : pct > 85
      ? "bg-status-failed"
      : pct > 60
        ? "bg-status-waiting"
        : "bg-primary";
  return (
    <div className="min-w-[9rem] flex-1 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xs tracking-wider text-muted-foreground uppercase">{label}</span>
        <span className="text-[13px] font-medium whitespace-nowrap tabular-nums">{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StageStrip({ f, stopped }: { f: FactoryStatus; stopped: boolean }) {
  const active = STAGES.findIndex((s) => s.id === f.loopState);
  const loop = LOOP_LABEL[f.loopState];
  return (
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
          loop.tone === "failed" && "bg-status-failed/12 text-status-failed",
          loop.tone === "waiting" && "bg-status-waiting/12 text-status-waiting",
          loop.tone === "running" && "bg-status-running/12 text-status-running",
          loop.tone === "idle" && "bg-muted text-muted-foreground",
        )}
        data-testid="factory-loop-state"
      >
        Loop {loop.label.toLowerCase()}
      </span>
    </div>
  );
}

/** Factory panel for autopilot and dark-factory projects (§10.1, experimental). */
export function FactoryPanel({ project }: { project: Project }) {
  const projectId = project.id;
  const client = useClient();
  const queryClient = useQueryClient();
  const { data: f } = useFactoryStatus(projectId);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: factoryKeys.all });
  const fail = (title: string) => (e: Error) => toast.error(title, { description: e.message });
  const resume = useMutation({
    mutationFn: () => client.factory.resume(projectId),
    onSuccess: () => {
      toast.success("Loop resumed");
      refresh();
    },
    onError: fail("Couldn't resume"),
  });
  const tick = useMutation({
    mutationFn: () => client.factory.tick(projectId),
    onSuccess: (s) => {
      queryClient.setQueryData(factoryKeys.status(projectId), s);
      toast.success(`Ran one step: loop ${LOOP_LABEL[s.loopState].label.toLowerCase()}`);
    },
    onError: fail("Couldn't run a step"),
  });
  const digest = useMutation({
    mutationFn: () => client.factory.digest(projectId),
    onSuccess: (d) => {
      toast.success("Digest ready in your inbox", {
        description: `${d.shipped.length} shipped, ${d.rejected.length} rejected, ${d.waiting.length} waiting`,
      });
      refresh();
    },
    onError: fail("Couldn't build the digest"),
  });

  if (!f) return <Skeleton className="h-72 w-full rounded-xl" />;
  const stopped = f.killSwitch || f.globalKillSwitch || f.loopState === "stopped";
  const budgetUsd = f.limits.dailyBudget.usd;
  const budgetTokens = f.limits.dailyBudget.tokens;

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-testid="factory-panel"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Factory className="size-4" />
        </span>
        <div>
          <div className="flex items-center gap-2 text-[14px] font-medium">
            {MODE_LABEL[f.mode]}
            {f.experimental && <ExperimentalBadge />}
          </div>
          <div className="text-2xs text-muted-foreground">
            {f.mode === "dark_factory"
              ? "Finders and issues feed the backlog; CodeDen merges when every check passes."
              : "New issues feed the backlog; CodeDen merges when every check passes."}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {f.loopState === "paused" && (
            <Button size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}>
              <Play /> Resume
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => tick.mutate()}
            disabled={tick.isPending || stopped}
          >
            <StepForward /> Run a step
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => digest.mutate()}
            disabled={digest.isPending}
          >
            <Newspaper /> Digest
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLimitsOpen(true)}>
            <SlidersHorizontal /> Limits
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/projects/$projectId/vision" params={{ projectId }}>
              <FileText /> Vision
            </Link>
          </Button>
          <KillSwitchButton scope={{ projectId }} on={f.killSwitch} />
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {(f.globalKillSwitch || f.pausedReason || !f.visionExists) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-status-waiting/30 bg-status-waiting/[0.06] px-3 py-2 text-2xs">
            <AlertTriangle className="size-3.5 text-status-waiting" />
            <span className="min-w-0 flex-1">
              {f.globalKillSwitch
                ? "The global kill switch is on: no project's factory runs."
                : !f.visionExists
                  ? "The vision file is missing; the loop will not start work without it."
                  : `Paused: ${f.pausedReason}`}
            </span>
            {f.globalKillSwitch && <KillSwitchButton scope="global" on size="xs" />}
          </div>
        )}
        <StageStrip f={f} stopped={stopped} />
        <div className="flex flex-wrap gap-2">
          <Meter
            label="Spend today"
            value={budgetUsd ? f.spendToday.usd : f.spendToday.tokens}
            max={budgetUsd ?? budgetTokens ?? 0}
            display={
              budgetUsd
                ? `${usd(f.spendToday.usd)} / ${usd(budgetUsd)}`
                : `${compact(f.spendToday.tokens)} / ${compact(budgetTokens ?? 0)}`
            }
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
            value={f.activeSessions}
            max={f.limits.maxConcurrentSessions}
            display={`${f.activeSessions} / ${f.limits.maxConcurrentSessions}`}
            warn={false}
          />
          <Meter
            label="Failures in a row"
            value={f.consecutiveFailures}
            max={f.limits.pauseAfterConsecutiveFailures}
            display={`${f.consecutiveFailures} / ${f.limits.pauseAfterConsecutiveFailures}`}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-3">
          <BacklogColumn projectId={projectId} backlog={f.backlog} inProgress={f.inProgress} />
          <ChecksColumn projectId={projectId} checks={f.mergeChecks} />
          <RecentColumn projectId={projectId} recent={f.recent} />
        </div>
        {f.lastDigest && (
          <details className="rounded-lg border border-border bg-surface px-3 py-2 text-2xs">
            <summary className="cursor-pointer text-muted-foreground">
              Digest {f.lastDigest.day}: {f.lastDigest.shipped.length} shipped,{" "}
              {f.lastDigest.rejected.length} rejected, {f.lastDigest.waiting.length} waiting on you
            </summary>
            <pre className="mt-2 font-sans text-2xs leading-relaxed whitespace-pre-wrap text-foreground/85">
              {f.lastDigest.text}
            </pre>
          </details>
        )}
        <p className="text-3xs text-muted-foreground/80">
          {compact(f.spendToday.tokens)} tokens today · protected:{" "}
          {f.limits.protectedPaths.join(", ") || "from the vision"} · deploys{" "}
          {f.limits.allowDeploys ? "allowed" : "off"} · CI{" "}
          {f.tuning.requireCi ? "required" : "optional"} · up to {f.tuning.maxChangedLines} changed
          lines
          {f.lastTickAt && ` · last step ${ago(f.lastTickAt)}`}
        </p>
      </div>
      <AutonomyDialog project={project} open={limitsOpen} onOpenChange={setLimitsOpen} />
    </section>
  );
}
