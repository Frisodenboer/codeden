import type { ScheduledRun, WorkSummary } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, CalendarClock, SkipForward, User, Workflow } from "lucide-react";
import { toast } from "sonner";
import { SectionLabel } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { useClient } from "@/lib/api";
import { automationKeys, useUpcomingRuns } from "@/lib/automations";
import { formatAt } from "@/lib/cron";
import { ageShort, until } from "@/lib/format";
import { cn } from "@/lib/utils";

const starterIcon = { user: User, orchestrator: Bot, pm: Bot, automation: Workflow };
const starterLabel = {
  user: "you",
  orchestrator: "orchestrator",
  pm: "PM",
  automation: "automation",
};

/** Body text while the work has not reported progress yet. */
function idleText(status: string): string {
  if (status === "queued") return "Queued behind running work";
  if (status === "waiting") return "Waiting for your answer in the inbox";
  if (status === "starting" || status === "created") return "Starting…";
  return "Working…";
}

function NowCard({ work, title }: { work: WorkSummary; title?: string | null }) {
  const Icon = starterIcon[work.startedBy.kind];
  const waiting = work.status === "waiting";
  const queued = work.status === "queued";
  const body = (
    <>
      <div className="flex items-center gap-2">
        <StatusDot tone={waiting ? "waiting" : queued ? "idle" : "running"} />
        <span className="truncate text-[13px] font-medium">{title ?? work.purpose}</span>
      </div>
      <p className="line-clamp-2 min-h-8 text-2xs leading-4 text-muted-foreground">
        {work.progress?.text ?? idleText(work.status)}
      </p>
      <div className="flex items-center gap-1.5 text-3xs text-muted-foreground/80">
        <Icon className="size-3" aria-label={`Started by ${starterLabel[work.startedBy.kind]}`} />
        <code className="truncate font-mono" title="Work key">
          {work.workKey}
        </code>
        <span
          className={cn("ml-auto shrink-0", waiting && "font-medium text-status-waiting")}
          title={`Started ${new Date(work.startedAt).toLocaleString()}`}
        >
          {waiting ? "Waiting on you" : queued ? "Queued" : ageShort(work.startedAt)}
        </span>
      </div>
    </>
  );
  const cls =
    "group flex w-64 shrink-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/30";
  if (!work.sessionId)
    return (
      <div className={cls} data-testid="now-card">
        {body}
      </div>
    );
  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: work.sessionId }}
      className={cls}
      data-testid="now-card"
    >
      {body}
    </Link>
  );
}

function NextRow({ run }: { run: ScheduledRun }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const skip = useMutation({
    mutationFn: () => client.automations.skipNext(run.automationId, run.projectId ?? ""),
    onSuccess: (skipped) => {
      toast.success(skipped ? `Skipped the ${formatAt(run.at)} run` : "Nothing left to skip");
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
    onError: (e) => toast.error("Couldn't skip the run", { description: e.message }),
  });
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]",
        run.skipped && "opacity-60",
      )}
      data-testid="next-run"
      data-skipped={run.skipped || undefined}
      title={`${run.workKey} · ${formatAt(run.at)}`}
    >
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
      {run.projectId ? (
        <Link
          to="/projects/$projectId/automations/$automationId"
          params={{ projectId: run.projectId, automationId: run.automationId }}
          className={cn("truncate hover:underline", run.skipped && "line-through")}
        >
          {run.name}
        </Link>
      ) : (
        <span className={cn("truncate", run.skipped && "line-through")}>{run.name}</span>
      )}
      <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
        {until(run.at)}
      </span>
      {run.skipped ? (
        <span className="shrink-0 px-1.5 text-3xs text-status-waiting">Skipped</span>
      ) : (
        <button
          type="button"
          onClick={() => skip.mutate()}
          disabled={skip.isPending || !run.projectId}
          aria-label={`Skip the next ${run.name} run`}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-3xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-10 pointer-coarse:px-2.5"
        >
          <SkipForward className="size-3" /> Skip
        </button>
      )}
    </div>
  );
}

/** Upcoming scheduled runs of a project, live from the scheduler, with skip-next inline. */
export function NextRuns({ projectId, limit = 6 }: { projectId: string; limit?: number }) {
  const { data, isLoading } = useUpcomingRuns(projectId);
  const runs = data ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-1" data-testid="next-runs">
      {runs.length === 0 ? (
        <p className="px-3 py-5 text-center text-xs text-muted-foreground">
          {isLoading
            ? "Loading the schedule…"
            : "No scheduled runs. Enabled scheduled automations show their next runs here."}
        </p>
      ) : (
        runs.slice(0, limit).map((r) => <NextRow key={`${r.automationId}-${r.at}`} run={r} />)
      )}
    </div>
  );
}

/**
 * Now / Next (§8.4): running and queued work in the project (work key, purpose, progress, age)
 * and the upcoming scheduled runs.
 */
export function NowNext({
  work,
  projectId,
  titleOf,
}: {
  work: WorkSummary[];
  projectId: string;
  /** Session titles from the live snapshot, when known. */
  titleOf?: (sessionId: string | null) => string | null;
}) {
  const running = work.filter((w) => w.status !== "queued").length;
  return (
    <section
      className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"
      data-testid="now-next"
    >
      <div className="min-w-0">
        <SectionLabel className="mb-2 flex items-center gap-2">
          Now{" "}
          <span className="rounded-full bg-status-running/15 px-1.5 text-status-running tabular-nums">
            {running}
          </span>
          {work.length > running && (
            <span className="font-normal normal-case tracking-normal">
              · {work.length - running} queued
            </span>
          )}
        </SectionLabel>
        {work.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Nothing running right now.
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 scroll-thin">
            {work.map((w) => (
              <NowCard key={w.id} work={w} title={titleOf?.(w.sessionId)} />
            ))}
          </div>
        )}
      </div>
      <div>
        <SectionLabel className="mb-2">Next</SectionLabel>
        <NextRuns projectId={projectId} limit={5} />
      </div>
    </section>
  );
}
