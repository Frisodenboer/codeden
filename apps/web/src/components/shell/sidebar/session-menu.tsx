import { Archive, ArchiveRestore, ExternalLink, Link2, Pencil, Square } from "lucide-react";
import type { SessionActions } from "@/lib/session-actions";
import type { RowMenuEntry } from "./row-menu";

/** A session row's menu: open, rename, copy link, stop (while working), archive or unarchive. */
export function sessionMenuEntries(
  actions: SessionActions,
  startRename: () => void,
): RowMenuEntry[] {
  const entries: RowMenuEntry[] = [
    { label: "Open", icon: <ExternalLink />, onSelect: actions.open },
    { label: "Rename", icon: <Pencil />, onSelect: startRename, keepFocus: true },
    { label: "Copy link", icon: <Link2 />, onSelect: () => void actions.copyLink() },
  ];
  if (actions.canStop) entries.push({ label: "Stop", icon: <Square />, onSelect: actions.stop });
  entries.push(
    "separator",
    actions.archived
      ? { label: "Unarchive", icon: <ArchiveRestore />, onSelect: actions.unarchive }
      : { label: "Archive", icon: <Archive />, onSelect: actions.archive },
  );
  return entries;
}
