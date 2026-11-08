import { type Project, sortProjects } from "@codeden/contracts";

/**
 * Project list ordering (§13). The server sends projects in the canonical order (pinned first,
 * then `sortOrder`, then name); these helpers keep that order when the UI applies a change
 * locally, before or instead of waiting for the server's event.
 */

/** The pinned and unpinned groups of a list already in the canonical order. */
export function splitPinned(projects: readonly Project[]): {
  pinned: Project[];
  others: Project[];
} {
  return { pinned: projects.filter((p) => p.pinned), others: projects.filter((p) => !p.pinned) };
}

/** Apply a full ordered id list: each listed project's `sortOrder` becomes its index. */
export function withOrder(projects: readonly Project[], projectIds: readonly string[]): Project[] {
  const index = new Map(projectIds.map((id, i) => [id, i]));
  return sortProjects(
    projects.map((p) => {
      const sortOrder = index.get(p.id);
      return sortOrder === undefined || sortOrder === p.sortOrder ? p : { ...p, sortOrder };
    }),
  );
}

/** Pin or unpin one project; it keeps its `sortOrder`, as on the server. */
export function withPinned(projects: readonly Project[], id: string, pinned: boolean): Project[] {
  return sortProjects(
    projects.map((p) => (p.id === id && p.pinned !== pinned ? { ...p, pinned } : p)),
  );
}

/**
 * The full ordered id list after moving `id` to position `to` within its own group, or null
 * when nothing moves. Projects never cross between the pinned and unpinned groups here.
 */
export function moveWithinGroup(
  projects: readonly Project[],
  id: string,
  to: number,
): string[] | null {
  const { pinned, others } = splitPinned(projects);
  const group = pinned.some((p) => p.id === id) ? pinned : others;
  const from = group.findIndex((p) => p.id === id);
  const target = Math.max(0, Math.min(group.length - 1, to));
  if (from === -1 || from === target) return null;
  const ids = group.map((p) => p.id);
  ids.splice(target, 0, ...ids.splice(from, 1));
  return group === pinned
    ? [...ids, ...others.map((p) => p.id)]
    : [...pinned.map((p) => p.id), ...ids];
}

/** Undo a local pin or order change: take `pinned` and `sortOrder` back from `previous`. */
export function restoreOrder(
  projects: readonly Project[],
  previous: readonly Project[],
): Project[] {
  const before = new Map(previous.map((p) => [p.id, p]));
  return sortProjects(
    projects.map((p) => {
      const old = before.get(p.id);
      return old ? { ...p, pinned: old.pinned, sortOrder: old.sortOrder } : p;
    }),
  );
}
