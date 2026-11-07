import type { ScheduledRun, Session } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, CalendarClock, User, Workflow } from "lucide-react";
import { toast } from "sonner";
import { SectionLabel } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { useClient } from "@/lib/api";
import { ageShort, statusLabel, until } from "@/lib/format";
import { cn } from "@/lib/utils";

const starterIcon = { user: User, orchestrator: Bot, pm: Bot, automation: Workflow };

function NowCard({ session }: { session: Session }) {
  const Icon = starterIcon[session.startedBy.kind];
  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
      className="group flex w-64 shrink-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/30"
    >
      <div className="flex items-center gap-2">
        <StatusDot status={session.status} />
        <span className="truncate text-[13px] font-medium">{session.title ?? session.purpose}</span>
      </div>
      <p className="line-clamp-2 min-h-8 text-2xs leading-4 text-muted-foreground">
        {session.progress?.text ?? "Starting…"}
      </p>
      <div className="flex items-center gap-1.5 text-3xs text-muted-foreground/80">
        <Icon className="size-3" />
        <code className="truncate font-mono">{session.workKey}</code>
        <span
          className={cn(
            "ml-auto shrink-0",
            session.status === "waiting" && "font-medium text-status-waiting",
          )}
        >
          {session.status === "waiting" ? statusLabel.waiting : ageShort(session.createdAt)}
        </span>
      </div>
    </Link>
  );
}

function NextRow({ run }: { run: ScheduledRun }) {
  const client = useClient();
  const skip = useMutation({
    mutationFn: () => client.skipNextRun(run.automationId),
    onSuccess: () => toast(run.skipped ? "Next run restored" : "Next run skipped"),
  });
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]",
        run.skipped && "opacity-55",
      )}
    >
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", run.skipped && "line-through")}>{run.name}</span>
      <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
        {until(run.at)}
      </span>
      <button
        type="button"
        onClick={() => skip.mutate()}
        className="shrink-0 rounded px-1.5 text-3xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {run.skipped ? "Restore" : "Skip"}
      </button>
    </div>
  );
}

/** Now / Next (§8.4): what's running in the project and what's scheduled to start. */
export function NowNext({ running, scheduled }: { running: Session[]; scheduled: ScheduledRun[] }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        <SectionLabel className="mb-2 flex items-center gap-2">
          Now{" "}
          <span className="rounded-full bg-status-running/15 px-1.5 text-status-running tabular-nums">
            {running.length}
          </span>
        </SectionLabel>
        {running.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Nothing running right now.
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 scroll-thin">
            {running.map((s) => (
              <NowCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>
      <div>
        <SectionLabel className="mb-2">Next</SectionLabel>
        <div className="rounded-xl border border-border bg-card p-1">
          {scheduled.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No scheduled runs.
            </p>
          ) : (
            scheduled.slice(0, 5).map((r) => <NextRow key={`${r.automationId}-${r.at}`} run={r} />)
          )}
        </div>
      </div>
    </section>
  );
}
