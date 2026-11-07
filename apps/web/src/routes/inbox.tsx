import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { snapshotQuery } from "@/lib/api";
import { PageHeader } from "./page-header";

/** Inbox (§11.1): everything waiting on you. */
export function InboxPage() {
  const { data } = useQuery(snapshotQuery);
  const items = data?.inbox ?? [];
  return (
    <>
      <PageHeader title="Inbox" meta={`${items.length} open`} />
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Inbox className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">You're all caught up</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Questions, approvals, PRs ready for review and failed runs will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-3 text-sm">
              {item.title}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
