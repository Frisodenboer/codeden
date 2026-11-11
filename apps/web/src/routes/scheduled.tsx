import type { ScheduledRun, ScheduledWakeup } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClock, Bot, CalendarClock, RefreshCw, SkipForward, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, SectionLabel } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { automationKeys } from "@/lib/automations";
import { formatAt } from "@/lib/cron";
import { until } from "@/lib/format";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";

const scheduledKey = ["scheduled"];

function When({ at }: { at: string }) {
  return (
    <span className="w-40 shrink-0 text-xs tabular-nums text-muted-foreground" title={at}>
      {formatAt(at)}
      <span className="ml-1.5 text-muted-foreground/70">({until(at)})</span>
    </span>
  );
}

function ProjectLabel({ projectId }: { projectId: string | null }) {
  const name = useSnapshotData(
    (s) => (projectId ? s.projects.find((p) => p.id === projectId)?.name : undefined),
    undefined,
  );
  if (!projectId) return <span className="text-xs text-muted-foreground">Orchestrator</span>;
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId }}
      className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      {name ?? "Project"}
    </Link>
  );
}

function RunRow({ run }: { run: ScheduledRun }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scheduledKey });
    void queryClient.invalidateQueries({ queryKey: automationKeys.all });
  };
  const skip = useMutation({
    mutationFn: () =>
      run.skipped
        ? client.automations.unskipNext(run.automationId, run.projectId ?? "")
        : client.automations.skipNext(run.automationId, run.projectId ?? ""),
    onSuccess: () => {
      toast.success(
        run.skipped ? "This run will happen again" : `Skipped the ${formatAt(run.at)} run`,
      );
      refresh();
    },
    onError: (e) => toast.error("Couldn't change the run", { description: e.message }),
  });
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2",
        run.skipped && "opacity-60",
      )}
    >
      <CalendarClock className="size-4 shrink-0 text-primary/80" />
      <When at={run.at} />
      <div className="min-w-0 flex-1">
        {run.projectId ? (
          <Link
            to="/projects/$projectId/automations/$automationId"
            params={{ projectId: run.projectId, automationId: run.automationId }}
            className={cn(
              "block truncate text-[13px] hover:underline",
              run.skipped && "line-through",
            )}
          >
            {run.name}
          </Link>
        ) : (
          <span className="block truncate text-[13px]">{run.name}</span>
        )}
        <ProjectLabel projectId={run.projectId} />
      </div>
      {run.projectId && (
        <Button
          size="sm"
          variant="ghost"
          disabled={skip.isPending}
          onClick={() => skip.mutate()}
          title={run.skipped ? "Run it after all" : "Skip this run"}
        >
          {run.skipped ? <Undo2 /> : <SkipForward />}
          <span className="hidden sm:inline">{run.skipped ? "Unskip" : "Skip"}</span>
        </Button>
      )}
    </li>
  );
}

function WakeupRow({ wakeup }: { wakeup: ScheduledWakeup }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => client.cancelWakeup(wakeup.id, wakeup.target, wakeup.projectId),
    onSuccess: () => {
      toast.success("Wake-up cancelled");
      void queryClient.invalidateQueries({ queryKey: scheduledKey });
    },
    onError: (e) => toast.error("Couldn't cancel the wake-up", { description: e.message }),
  });
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
      <AlarmClock className="size-4 shrink-0 text-primary/80" />
      <When at={wakeup.at} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[13px]" title={wakeup.note}>
          {wakeup.note}
        </span>
        <span className="flex items-center gap-1">
          <Bot className="size-3 text-muted-foreground" />
          {wakeup.target === "pm" ? (
            <>
              <span className="text-xs text-muted-foreground">PM of</span>
              <ProjectLabel projectId={wakeup.projectId} />
            </>
          ) : (
            <ProjectLabel projectId={null} />
          )}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
        title="Cancel this wake-up"
      >
        <X />
        <span className="hidden sm:inline">Cancel</span>
      </Button>
    </li>
  );
}

/** Everything scheduled to run later: automation runs and agent wake-ups, across all projects. */
export function ScheduledPage() {
  const client = useClient();
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: scheduledKey,
    queryFn: () => client.getScheduled(),
    refetchInterval: 60_000,
  });
  const runs = data.data?.runs ?? [];
  const wakeups = data.data?.wakeups ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<CalendarClock />}
        title="Scheduled"
        meta="Automation runs and agent wake-ups across all projects"
        actions={
          <Button
            size="sm"
            variant="ghost"
            title="Refresh"
            onClick={() => queryClient.invalidateQueries({ queryKey: scheduledKey })}
          >
            <RefreshCw className={cn(data.isFetching && "animate-spin")} />
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mr-auto w-full max-w-[52rem] space-y-8 px-4 py-6 sm:px-6">
          {data.error ? (
            <div className="text-sm text-status-failed">{data.error.message}</div>
          ) : data.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : runs.length === 0 && wakeups.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="Nothing scheduled">
              Automations on a schedule and wake-ups the orchestrator or a PM set for themselves
              show up here.
            </EmptyState>
          ) : (
            <>
              <section>
                <SectionLabel>Automation runs ({runs.length})</SectionLabel>
                {runs.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No scheduled automations are enabled.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {runs.map((r) => (
                      <RunRow key={`${r.automationId}-${r.projectId}-${r.at}`} run={r} />
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <SectionLabel>Agent wake-ups ({wakeups.length})</SectionLabel>
                {wakeups.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The orchestrator and PMs have no wake-ups planned.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {wakeups.map((w) => (
                      <WakeupRow key={w.id} wakeup={w} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
