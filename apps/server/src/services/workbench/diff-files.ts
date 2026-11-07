import type { DiffFile, DiffFileStat } from "@codeden/contracts";

const CHANGE: Record<DiffFileStat["status"], DiffFile["change"]> = {
  added: "add",
  modified: "modify",
  deleted: "delete",
  renamed: "rename",
  copied: "add",
  type_changed: "modify",
};

/** Split a unified `git diff` into per-file patches keyed by the new (or deleted) path. */
export function splitPatch(diff: string): Map<string, string> {
  const out = new Map<string, string>();
  const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "));
  for (const chunk of chunks) {
    const path = patchPath(chunk);
    if (path !== undefined) out.set(path, chunk);
  }
  return out;
}

/** Path a file patch belongs to: `+++ b/<path>`, or `--- a/<path>` for deletions. */
function patchPath(chunk: string): string | undefined {
  const plus = /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1];
  if (plus) return unquote(plus);
  const minus = /^--- a\/(.+)$/m.exec(chunk)?.[1];
  if (minus) return unquote(minus);
  // Binary files and pure renames carry no ---/+++ lines.
  const header = /^diff --git a\/(.+) b\/(.+)$/m.exec(chunk);
  return header?.[2] ? unquote(header[2]) : undefined;
}

function unquote(path: string): string {
  return path.replace(/\t.*$/, "").replace(/^"(.*)"$/, "$1");
}

/** Combine runner stats and the unified diff into the UI's per-file shape. */
export function toDiffFiles(diff: string, stats: DiffFileStat[]): DiffFile[] {
  const patches = splitPatch(diff);
  return stats.map((stat) => ({
    path: stat.path,
    ...(stat.oldPath ? { previousPath: stat.oldPath } : {}),
    change: CHANGE[stat.status],
    additions: stat.additions,
    deletions: stat.deletions,
    ...(stat.binary ? { binary: true } : {}),
    patch: patches.get(stat.path) ?? "",
  }));
}

/** Per-file stats from a unified diff, for runner results that carry no stats. */
export function statsFromPatch(diff: string): DiffFileStat[] {
  const stats: DiffFileStat[] = [];
  for (const [path, chunk] of splitPatch(diff)) {
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    const status: DiffFileStat["status"] = /^new file mode/m.test(chunk)
      ? "added"
      : /^deleted file mode/m.test(chunk)
        ? "deleted"
        : /^rename from/m.test(chunk)
          ? "renamed"
          : "modified";
    const oldPath = /^rename from (.+)$/m.exec(chunk)?.[1];
    stats.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      status,
      additions,
      deletions,
      binary: /^Binary files /m.test(chunk),
    });
  }
  return stats;
}
