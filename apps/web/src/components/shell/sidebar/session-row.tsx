import type { Session } from "@codeden/contracts";
import { useEffect, useRef, useState } from "react";
import { IssueBadge, PrBadge } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { ageShort, statusTone } from "@/lib/format";
import { useSessionActions } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { childRow, NavRow, rowBase } from "./nav-row";
import { RowMenu, RowMenuButton, useRowMenu } from "./row-menu";
import { sessionMenuEntries } from "./session-menu";

/**
 * Inline title editor: Enter or leaving the field saves, Escape cancels. `byKey` says whether
 * a key ended the edit (focus then goes back to the row) or focus moved elsewhere.
 */
function RenameField({
  title,
  onDone,
}: {
  title: string;
  onDone: (next: string | null, byKey: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (next: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(next, byKey);
  };
  return (
    <input
      ref={input}
      defaultValue={title}
      maxLength={200}
      aria-label="Session title"
      className="h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value, true);
        if (e.key === "Escape") finish(null, true);
      }}
      onBlur={(e) => finish(e.currentTarget.value, false)}
    />
  );
}

/**
 * A session in a project group. Right-click, the ⋯ button (on hover or focus) or Shift+F10
 * open its menu; the ⋯ takes the age's place while it shows.
 */
export function SessionRow({ session }: { session: Session }) {
  const actions = useSessionActions(session);
  const menu = useRowMenu();
  const [renaming, setRenaming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const tone = statusTone[session.status];
  const settled = tone === "done" || tone === "idle";
  const title = session.title ?? session.purpose;
  const entries = sessionMenuEntries(actions, () => setRenaming(true));

  return (
    <RowMenu menu={menu} entries={entries}>
      <div ref={row} className="group/session relative" data-session-id={session.id}>
        {renaming ? (
          <div className={cn(rowBase, childRow, "hover:bg-transparent")}>
            <StatusDot status={session.status} />
            <RenameField
              title={title}
              onDone={(next, byKey) => {
                setRenaming(false);
                if (next !== null) actions.rename(next);
                // Back to the row's link, so keyboard users keep their place.
                if (byKey) requestAnimationFrame(() => row.current?.querySelector("a")?.focus());
              }}
            />
          </div>
        ) : (
          <NavRow
            href={`/sessions/${session.id}`}
            link={{ to: "/sessions/$sessionId", params: { sessionId: session.id } }}
            className={childRow}
            title={session.progress?.text ?? session.purpose}
          >
            <StatusDot status={session.status} />
            <span
              className={cn("min-w-0 flex-1 truncate", settled && "text-sidebar-foreground/55")}
            >
              {title}
            </span>
            {session.pr ? (
              <PrBadge pr={session.pr} />
            ) : session.issue ? (
              <IssueBadge issue={session.issue} />
            ) : null}
            <span
              className={cn(
                "w-6 shrink-0 text-right text-3xs tabular-nums transition-opacity group-focus-within/session:opacity-0 group-hover/session:opacity-0 group-has-[[data-state=open]]/session:opacity-0 touch:opacity-0",
                tone === "waiting" ? "font-medium text-status-waiting" : "text-muted-foreground/70",
              )}
            >
              {tone === "waiting" ? "you" : ageShort(session.updatedAt)}
            </span>
          </NavRow>
        )}
        {!renaming && (
          <RowMenuButton
            menu={menu}
            entries={entries}
            label={`${title} actions`}
            className="absolute top-1/2 right-1 size-6 -translate-y-1/2 opacity-0 transition-opacity group-focus-within/session:opacity-100 group-hover/session:opacity-100 data-[state=open]:opacity-100 touch:size-9 touch:opacity-100"
          />
        )}
      </div>
    </RowMenu>
  );
}
