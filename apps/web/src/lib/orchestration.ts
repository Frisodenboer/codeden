import type { ProjectStatus, Session, Snapshot, WorkSummary } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { useClient } from "./api";
import { isActive } from "./format";
import { useSnapshotData } from "./queries";

/** Query key of a project's status digest (`/api/orchestration/projects/:id/status`). */
export const projectStatusKey = (projectId: string) => ["project-status", projectId] as const;

/** A session as a `WorkSummary` (the same shape the status digest uses). */
export function sessionWork(s: Session): WorkSummary {
  return {
    kind: "session",
    id: s.id,
    sessionId: s.id,
    projectId: s.projectId,
    startedBy: s.startedBy,
    purpose: s.purpose,
    workKey: s.workKey,
    scope: s.scope,
    progress: s.progress,
    status: s.status,
    startedAt: s.createdAt,
  };
}

/** Running and queued agent work from the live snapshot (fallback while the digest loads). */
export function snapshotWork(snap: Snapshot, projectId: string): WorkSummary[] {
  return snap.sessions
    .filter((s) => s.projectId === projectId && s.role === "agent" && isActive(s.status))
    .map(sessionWork);
}

/**
 * Now / Next data for a project: the server's status digest (sessions and automation runs,
 * queued work, scheduled runs), refreshed on session events and every 15 s.
 */
export function useProjectStatus(projectId: string): {
  work: WorkSummary[];
  status: ProjectStatus | undefined;
} {
  const client = useClient();
  const fallback = useSnapshotData((s) => snapshotWork(s, projectId), []);
  const { data } = useQuery({
    queryKey: projectStatusKey(projectId),
    queryFn: () => client.orchestration.projectStatus(projectId),
    refetchInterval: 15_000,
  });
  if (!data) return { work: fallback, status: undefined };
  // Progress and status move faster than the digest refresh: prefer the live session.
  const live = new Map(fallback.map((w) => [w.id, w]));
  const work = [...data.running, ...data.queued].map((w) => live.get(w.id) ?? w);
  for (const w of fallback) if (!work.some((x) => x.id === w.id)) work.push(w);
  return { work, status: data };
}

/** The `<codeden_status>` digest and notices prepended to role-session messages (§8.4). */
export interface FoldedMessage {
  /** The status digest block (with its tags), when present. */
  status: string | null;
  /** The "Updates since your last turn" list (without the `<codeden_updates>` tags). */
  updates: string | null;
  /** What the sender actually wrote. */
  text: string;
  /** The message is an automatic wake-up for notices, not something a person typed. */
  wake: boolean;
}

const STATUS_RE = /^\s*<codeden_status\b[^>]*>[\s\S]*?<\/codeden_status>\s*/;
const UPDATES_RE = /^<codeden_updates\b[^>]*>([\s\S]*?)<\/codeden_updates>\s*/;
const UPDATES_HEAD = "Updates since your last turn:";
const WAKE_PREFIX = "Automatic wake-up for the updates above.";

/**
 * Split a role-session user message into the injected status, updates and the real text.
 * The server wraps both injected blocks in tags; messages sent before the updates had tags
 * fall back to `legacyUpdatesEnd`.
 */
export function foldDigest(raw: string): FoldedMessage {
  let rest = raw;
  let status: string | null = null;
  const match = STATUS_RE.exec(rest);
  if (match) {
    status = match[0].trim();
    rest = rest.slice(match[0].length);
  }
  let updates: string | null = null;
  const tagged = UPDATES_RE.exec(rest);
  if (tagged) {
    updates = (tagged[1] ?? "").trim();
    rest = rest.slice(tagged[0].length);
  } else if (rest.startsWith(UPDATES_HEAD)) {
    const end = legacyUpdatesEnd(rest);
    updates = rest.slice(0, end).trim();
    rest = rest.slice(end);
  }
  const text = rest.trim();
  return { status, updates, text, wake: text.startsWith(WAKE_PREFIX) };
}

/**
 * Where an untagged updates list (older messages) ends. Notices quote free text in `"…"`,
 * which can span paragraphs, so the list ends at the first blank line outside a quote: where
 * the number of `"` so far is even. If quotes never balance (a stray `"` inside a notice),
 * fall back to the first blank line rather than hiding the sender's text.
 */
export function legacyUpdatesEnd(rest: string): number {
  const first = rest.indexOf("\n\n");
  if (first === -1) return rest.length;
  let quotes = 0;
  let counted = 0;
  for (let blank = first; blank !== -1; blank = rest.indexOf("\n\n", blank + 2)) {
    for (; counted < blank; counted++) if (rest[counted] === '"') quotes++;
    if (quotes % 2 === 0) return blank;
  }
  return first;
}
