import type { ArchiveSessionResponse, Session, Settings } from "@codeden/contracts";
import { errorMessage } from "../errors";
import type { SessionRepo } from "./repo";

/** How long a successful agent stays in the sidebar after it finished. */
export const ARCHIVE_SUCCESS_AFTER_MS = 10 * 60_000;
/** How long an agent that finished with another outcome (partial, blocked, failed) stays. */
export const ARCHIVE_OTHER_AFTER_MS = 24 * 60 * 60_000;

/**
 * Whether an agent session's work is done and it can leave the sidebar: it reported a result
 * with the `finish` tool, is idle with nothing queued, has no open pull request (PR feedback
 * needs the session) and has been quiet since: 10 minutes after a success, a day after any other
 * outcome, so a partial or blocked result stays in view long enough to act on. Pure.
 */
export function archiveDue(
  session: Session,
  now: number,
  opts: { queued: boolean; successAfterMs?: number; otherAfterMs?: number },
): boolean {
  if (session.role !== "agent" || session.archivedAt || !session.result) return false;
  if (session.status !== "idle" && session.status !== "completed") return false;
  if (opts.queued) return false;
  if (session.pr && (session.pr.state === "open" || session.pr.state === "draft")) return false;
  const quietSince = Math.max(Date.parse(session.result.at), Date.parse(session.updatedAt));
  const wait =
    session.result.outcome === "success"
      ? (opts.successAfterMs ?? ARCHIVE_SUCCESS_AFTER_MS)
      : (opts.otherAfterMs ?? ARCHIVE_OTHER_AFTER_MS);
  return now - quietSince >= wait;
}

export interface AutoArchiveDeps {
  repo: SessionRepo;
  settings: () => Settings;
  /** Archive a session: stop it, hide it from the sidebar, remove its worktree. */
  archive: (id: string) => Promise<ArchiveSessionResponse>;
  /** Show an archived session again. */
  unarchive: (id: string) => Session;
  /** Whether the session has queued messages waiting. */
  hasQueued: (id: string) => boolean;
  now?: () => number;
  /** How often to look for finished sessions (default every minute). */
  intervalMs?: number;
  successAfterMs?: number;
  otherAfterMs?: number;
  log?: (message: string) => void;
}

/**
 * Archives agent sessions whose work is done (`archiveDue`), so finished work leaves the
 * sidebar and its provider process and worktree go away. Sending the session a message brings
 * it back. A worktree with uncommitted changes is never thrown away: such a session is shown
 * again and left alone until it changes. Off with `sessions.autoArchive`.
 */
export class AutoArchive {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  /** Sessions kept for uncommitted changes, keyed to the `updatedAt` seen then. */
  private readonly kept = new Map<string, string>();

  constructor(private readonly deps: AutoArchiveDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.sweep(), this.deps.intervalMs ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Archive every session that is due. Returns the archived ids. */
  async sweep(): Promise<string[]> {
    if (this.running || !this.deps.settings().sessions.autoArchive) return [];
    this.running = true;
    const archived: string[] = [];
    try {
      const now = this.deps.now?.() ?? Date.now();
      for (const session of this.deps.repo.list({ role: "agent", status: ["idle", "completed"] })) {
        if (this.kept.get(session.id) === session.updatedAt) continue;
        const due = archiveDue(session, now, {
          queued: this.deps.hasQueued(session.id),
          ...(this.deps.successAfterMs !== undefined
            ? { successAfterMs: this.deps.successAfterMs }
            : {}),
          ...(this.deps.otherAfterMs !== undefined ? { otherAfterMs: this.deps.otherAfterMs } : {}),
        });
        if (!due) continue;
        try {
          const result = await this.deps.archive(session.id);
          if (result.worktree.status === "kept_changes") {
            const shown = this.deps.unarchive(session.id);
            this.kept.set(session.id, shown.updatedAt);
            this.deps.log?.(
              `auto-archive: kept ${session.id}, its worktree has uncommitted changes`,
            );
            continue;
          }
          archived.push(session.id);
          this.deps.log?.(`auto-archive: archived finished session ${session.id}`);
        } catch (error) {
          this.deps.log?.(`auto-archive for ${session.id}: ${errorMessage(error)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return archived;
  }
}
