import type { ArchiveSessionResponse, Session } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useClient } from "./api";
import { platform } from "./platform";

/** Sessions that can be stopped from a menu: ones with a turn running or a question open. */
export const canStop = (session: Pick<Session, "status">) =>
  session.status === "running" || session.status === "waiting";

/** A link to the session in this CodeDen (no token: the browser's cookie signs it in). */
export const sessionLink = (sessionId: string, origin = window.location.origin) =>
  `${origin}/sessions/${encodeURIComponent(sessionId)}`;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const brief = (text: string | null) =>
  text && text.length > 160 ? `${text.slice(0, 159).trimEnd()}…` : (text ?? undefined);

/**
 * Toast for an archive: what happened to the worktree, with Undo. Archiving always removes
 * the worktree; when that fails (a file still in use), the toast offers Try again.
 */
export function announceArchive(
  result: ArchiveSessionResponse,
  actions: { undo: () => void; retry: () => void },
): void {
  const undo = { label: "Undo", onClick: actions.undo };
  const { status, message: detail } = result.worktree;
  if (status === "removed") {
    toast.success("Session archived and its worktree removed", {
      action: undo,
      description: brief(detail),
    });
  } else if (status === "none") {
    toast.success("Session archived", { action: undo });
  } else {
    toast.warning("Session archived, but its worktree couldn't be removed yet", {
      description: brief(detail),
      action: { label: "Try again", onClick: actions.retry },
      cancel: undo,
      duration: 10_000,
    });
  }
}

/**
 * What you can do to a session from its row menu or the thread header's ⋯ menu: open, rename,
 * copy its link, stop, archive (with Undo) and unarchive. Both menus use this, so they show
 * the same toasts.
 */
export function useSessionActions(session: Session) {
  const client = useClient();
  const navigate = useNavigate();
  const onError = (error: unknown) => toast.error(message(error));

  const stop = useMutation({
    mutationFn: () => client.stopSession(session.id),
    onSuccess: () => toast("Session stopped"),
    onError,
  });
  const unarchive = useMutation({
    mutationFn: () => client.unarchiveSession(session.id),
    onSuccess: () => toast.success("Session restored to the sidebar"),
    onError,
  });
  const archive = useMutation({
    mutationFn: () => client.archiveSession(session.id),
    onSuccess: (result) =>
      announceArchive(result, {
        undo: () => unarchive.mutate(),
        retry: () => archive.mutate(),
      }),
    onError,
  });
  const rename = useMutation({
    mutationFn: (title: string) => client.updateSession(session.id, { title }),
    onError,
  });

  return {
    open: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } }),
    /** Save a new title; blank or unchanged titles are ignored. */
    rename: (title: string) => {
      const next = title.trim().slice(0, 200);
      if (next && next !== (session.title ?? session.purpose)) rename.mutate(next);
    },
    copyLink: async () => {
      try {
        await platform.writeClipboard(sessionLink(session.id));
        toast.success("Link copied");
      } catch (error) {
        onError(error);
      }
    },
    canStop: canStop(session),
    stop: () => stop.mutate(),
    archived: Boolean(session.archivedAt),
    archive: () => archive.mutate(),
    unarchive: () => unarchive.mutate(),
  };
}

export type SessionActions = ReturnType<typeof useSessionActions>;
