import type { Session } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { IssueBadge, PrBadge, ProviderMark } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { ageShort, statusLabel } from "@/lib/format";

const startedBy = { user: "You", orchestrator: "Orchestrator", pm: "PM", automation: "Automation" };

/** All agent sessions in the project. */
export function SessionsList({ sessions }: { sessions: Session[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {sessions.map((s) => (
        <Link
          key={s.id}
          to="/sessions/$sessionId"
          params={{ sessionId: s.id }}
          className="grid grid-cols-[16px_minmax(0,1fr)_96px_110px_44px] items-center gap-3 border-b border-border px-3.5 py-2 text-[13px] transition-colors last:border-0 hover:bg-accent/40"
        >
          <StatusDot status={s.status} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{s.title ?? s.purpose}</span>
              {s.issue && <IssueBadge issue={s.issue} />}
              {s.pr && <PrBadge pr={s.pr} />}
            </span>
            <span className="block truncate font-mono text-3xs text-muted-foreground">
              {s.workKey} · {s.branch}
            </span>
          </span>
          <span className="text-2xs text-muted-foreground">{statusLabel[s.status]}</span>
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <ProviderMark provider={s.provider} /> {startedBy[s.startedBy.kind]}
          </span>
          <span className="text-right text-2xs text-muted-foreground tabular-nums">
            {ageShort(s.updatedAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}
