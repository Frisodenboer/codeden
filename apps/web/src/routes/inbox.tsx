import { useQuery } from "@tanstack/react-query";
import { CheckCheck, Inbox } from "lucide-react";
import { useState } from "react";
import { EmptyState, SectionLabel } from "@/components/common/bits";
import { InboxEntry } from "@/components/inbox/inbox-entry";
import { ConflictCard } from "@/components/project/conflict-card";
import { useClient } from "@/lib/api";
import { groupInbox, type InboxFilter, inboxCounts } from "@/lib/inbox";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "asks", label: "Needs an answer" },
  { id: "reviews", label: "Reviews" },
  { id: "problems", label: "Problems" },
];

/** Inbox (§11.1): everything waiting on you, answerable in place. */
export function InboxPage() {
  const client = useClient();
  const items = useSnapshotData((s) => s.inbox, []);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const conflicts = useQuery({ queryKey: ["conflicts"], queryFn: () => client.listConflicts() });
  const conflictList = conflicts.data ?? [];
  const groups = groupInbox(items, filter);
  const counts = inboxCounts(items, conflictList.length);
  const resolved = items.filter((i) => i.status !== "open").slice(0, 5);
  const showConflicts = (filter === "all" || filter === "asks") && conflictList.length > 0;

  return (
    <>
      <PageHeader icon={<Inbox />} title="Inbox" meta={`${counts.all} waiting on you`} />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
          <div className="mb-6 flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-card/50 p-0.5 text-xs">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground pointer-coarse:h-10",
                  filter === f.id && "bg-accent text-foreground",
                )}
              >
                {f.label}
                <span className="text-3xs tabular-nums opacity-70">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {groups.length === 0 && !showConflicts ? (
            <EmptyState icon={<CheckCheck />} title="You're all caught up" className="py-24">
              Questions, approvals, PRs ready for review and failed runs show up here.
            </EmptyState>
          ) : (
            <div className="space-y-9">
              {showConflicts && (
                <section>
                  <SectionLabel className="mb-3">Conflicts · {conflictList.length}</SectionLabel>
                  <div className="space-y-4">
                    {conflictList.map((c) => (
                      <ConflictCard key={c.id} conflict={c} />
                    ))}
                  </div>
                </section>
              )}
              {groups.map((g) => (
                <section key={g.id}>
                  <SectionLabel className="mb-3">
                    {g.title} · {g.items.length}
                  </SectionLabel>
                  <div className="space-y-5">
                    {g.items.map((item) => (
                      <InboxEntry key={item.id} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <section className="mt-12">
              <SectionLabel className="mb-3">Recently resolved</SectionLabel>
              <div className="space-y-3">
                {resolved.map((item) => (
                  <InboxEntry key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
