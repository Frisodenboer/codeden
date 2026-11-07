import type { GitStatusResponse, SessionFileEntry } from "@codeden/contracts";
import type { FileNode } from "./api/types";

/** Map a porcelain status code (`M`, `A`, `??`, `D`, ...) to the tree's file badge. */
export function badgeFor(code: string): FileNode["status"] {
  const c = code.trim();
  if (c.includes("D")) return "deleted";
  if (c === "??" || c.includes("A")) return "added";
  if (c) return "modified";
  return undefined;
}

/**
 * Build the files panel tree from a flat, depth-first listing. Git status marks changed files;
 * folders inherit no badge. Paths use `/`.
 */
export function buildFileTree(
  entries: SessionFileEntry[],
  status?: GitStatusResponse["files"],
): FileNode[] {
  const badges = new Map(
    (status ?? []).map((f) => [f.path.replace(/\\/g, "/"), badgeFor(f.status)]),
  );
  const roots: FileNode[] = [];
  const dirs = new Map<string, FileNode>();
  for (const e of entries) {
    const slash = e.path.lastIndexOf("/");
    const node: FileNode = {
      name: slash === -1 ? e.path : e.path.slice(slash + 1),
      path: e.path,
      kind: e.kind,
      ...(e.kind === "dir" ? { children: [] } : {}),
    };
    const badge = badges.get(e.path);
    if (badge) node.status = badge;
    if (e.kind === "dir") dirs.set(e.path, node);
    const parent = slash === -1 ? undefined : dirs.get(e.path.slice(0, slash));
    if (parent?.children) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
