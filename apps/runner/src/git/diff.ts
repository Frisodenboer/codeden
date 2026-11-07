import type { DiffFileStat } from "@codeden/contracts";
import { git, splitNul } from "./exec";

const STATUS: Record<string, DiffFileStat["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type_changed",
};

interface NameStatus {
  status: DiffFileStat["status"];
  path: string;
  oldPath?: string;
}

/** Parse `git diff --name-status -z` output. */
export function parseNameStatus(out: Buffer | string): NameStatus[] {
  const fields = splitNul(out);
  const result: NameStatus[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i++] ?? "";
    const status = STATUS[code[0] ?? ""] ?? "modified";
    if (status === "renamed" || status === "copied") {
      const oldPath = fields[i++] ?? "";
      const path = fields[i++] ?? "";
      result.push({ status, path, oldPath });
    } else {
      result.push({ status, path: fields[i++] ?? "" });
    }
  }
  return result;
}

interface NumStat {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** Parse `git diff --numstat -z` output (renames use `\0old\0new` after an empty path). */
export function parseNumStat(out: Buffer | string): NumStat[] {
  const fields = splitNul(out);
  const result: NumStat[] = [];
  for (let i = 0; i < fields.length; ) {
    const head = fields[i++] ?? "";
    const [add = "0", del = "0", inlinePath = ""] = head.split("\t");
    let path = inlinePath;
    if (path === "") {
      i++; // old path
      path = fields[i++] ?? "";
    }
    const binary = add === "-" && del === "-";
    result.push({
      path,
      additions: binary ? 0 : Number(add),
      deletions: binary ? 0 : Number(del),
      binary,
    });
  }
  return result;
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "-M", "--full-index"];

/**
 * Unified diff and per-file stats between two tree-ish objects. Never reads or writes the
 * index or working tree.
 */
export async function diffTrees(
  cwd: string,
  from: string,
  to: string,
  paths: string[] = [],
): Promise<{ diff: string; files: DiffFileStat[] }> {
  const spec = paths.length > 0 ? ["--", ...paths] : [];
  const [patch, names, nums] = await Promise.all([
    git(cwd, ["diff", ...DIFF_FLAGS, from, to, ...spec], { timeoutMs: 120_000 }),
    git(cwd, ["diff", "--name-status", "-z", "-M", from, to, ...spec]),
    git(cwd, ["diff", "--numstat", "-z", "-M", from, to, ...spec]),
  ]);
  const stats = new Map(parseNumStat(nums.stdout).map((s) => [s.path, s]));
  const files = parseNameStatus(names.stdout).map((entry): DiffFileStat => {
    const stat = stats.get(entry.path);
    return {
      path: entry.path,
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      status: entry.status,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      binary: stat?.binary ?? false,
    };
  });
  return { diff: patch.stdout.toString("utf8"), files };
}
