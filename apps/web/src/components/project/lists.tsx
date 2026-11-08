import type { Session } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { ArchiveRestore } from "lucide-react";
import { IssueBadge, PrBadge, ProviderMark } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { ageShort, statusLabel } from "@/lib/format";
import { useSessionActions } from "@/lib/session-actions";

const startedBy = { user: "You", orchestrator: "Orchestrator", pm: "PM", automation: "Automation" };

/** Unarchive from the list; sits above the row's stretched link. */
function UnarchiveButton({ session }: { session: Session }) {
  const actions = useSessionActions(session);
  return (
    <Button
      size="xs"
      variant="outline"
      className="relative z-10"
      onClick={actions.unarchive}
      aria-label={`Unarchive ${session.title ?? session.purpose}`}
    >
      <ArchiveRestore /> Unarchive
    </Button>
  );
}

/** A project's agent sessions; archived ones get an Unarchive action. */
export function SessionsList({ sessions }: { sessions: Session[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {sessions.map((s) => (
        <div
          key={s.id}
          data-session-id={s.id}
          className="relative grid grid-cols-[16px_minmax(0,1fr)_96px_110px_auto] items-center gap-3 border-b border-border px-3.5 py-2 text-[13px] transition-colors last:border-0 hover:bg-accent/40"
        >
          <StatusDot status={s.status} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              {/* The link covers the whole row; buttons above it stay clickable. */}
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: s.id }}
                className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                {s.title ?? s.purpose}
              </Link>
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
          {s.archivedAt ? (
            <UnarchiveButton session={s} />
          ) : (
            <span className="w-11 text-right text-2xs text-muted-foreground tabular-nums">
              {ageShort(s.updatedAt)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
