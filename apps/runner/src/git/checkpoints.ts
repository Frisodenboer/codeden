import { randomBytes } from "node:crypto";
import { copyFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DiffFileStat } from "@codeden/contracts";
import { CommandError } from "../errors";
import { diffTrees, parseNameStatus } from "./diff";
import { git, gitText } from "./exec";

/** Root of all checkpoint refs. */
export const CHECKPOINT_ROOT = "refs/codeden/checkpoints";

const IDENTITY = {
  GIT_AUTHOR_NAME: "CodeBench",
  GIT_AUTHOR_EMAIL: "codeden@localhost",
  GIT_COMMITTER_NAME: "CodeBench",
  GIT_COMMITTER_EMAIL: "codeden@localhost",
};

/** A session id made safe for use as one ref path component. */
export function refComponent(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.length > 0 ? safe : "_";
}

export function checkpointRef(sessionId: string, index: number): string {
  return `${CHECKPOINT_ROOT}/${refComponent(sessionId)}/${index}`;
}

export interface CheckpointInfo {
  index: number;
  ref: string;
  commit: string;
  createdAt: string;
}

/** Repository top level of `cwd`, as a native absolute path. */
export async function topLevel(cwd: string): Promise<string> {
  return resolve(await gitText(cwd, ["rev-parse", "--show-toplevel"]));
}

/**
 * Copy the index for use as a temporary index, keeping its modification time. Git trusts an
 * entry's cached stat data only when the entry is older than the index file; an entry written
 * in the same timestamp tick as the index is "racily clean" and its content is re-read. A
 * copy stamped with the current time (Linux `copyFile` does that) would make such entries
 * look safe, and a same-size rewrite in that tick would be missed by diffs and checkpoints.
 */
async function copyIndex(realIndex: string, tmp: string): Promise<void> {
  try {
    await copyFile(realIndex, tmp);
  } catch {
    return; // no index yet in a fresh repo
  }
  const { atime, mtime } = await stat(realIndex);
  // Millisecond precision rounds down, which only ever makes more entries racy (re-read).
  await utimes(tmp, atime, mtime);
}

/**
 * Write the full working tree (tracked + untracked, minus ignored files) as a tree object
 * using a temporary index seeded from a copy of the real one (for its stat cache). The
 * user's index, HEAD and branch are never modified.
 */
export async function snapshotTree(cwd: string): Promise<string> {
  const top = await topLevel(cwd);
  const realIndex = await gitText(top, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  const tmp = join(tmpdir(), `codeden-index-${randomBytes(8).toString("hex")}`);
  try {
    await copyIndex(realIndex, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    await git(top, ["add", "-A", "--", "."], { env, timeoutMs: 10 * 60_000 });
    return await gitText(top, ["write-tree"], { env });
  } finally {
    await rm(tmp, { force: true });
    await rm(`${tmp}.lock`, { force: true });
  }
}

/** Resolve a ref to a commit id, or undefined when it doesn't exist. */
async function resolveCommit(cwd: string, ref: string): Promise<string | undefined> {
  try {
    return await gitText(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    return undefined;
  }
}

/** Existing checkpoints of a session, ordered by index. */
export async function listCheckpoints(cwd: string, sessionId: string): Promise<CheckpointInfo[]> {
  const prefix = `${CHECKPOINT_ROOT}/${refComponent(sessionId)}/`;
  const out = await git(cwd, [
    "for-each-ref",
    "--format=%(refname)%00%(objectname)%00%(creatordate:iso-strict)",
    prefix,
  ]);
  const result: CheckpointInfo[] = [];
  for (const line of out.stdout.toString("utf8").split("\n")) {
    if (!line) continue;
    const [ref = "", commit = "", date = ""] = line.split("\0");
    const index = Number(ref.slice(prefix.length));
    if (!Number.isInteger(index) || index < 0) continue;
    result.push({ index, ref, commit, createdAt: new Date(date).toISOString() });
  }
  return result.sort((a, b) => a.index - b.index);
}

/** Next free checkpoint index for a session (0 when none exist). */
export async function nextCheckpointIndex(cwd: string, sessionId: string): Promise<number> {
  const existing = await listCheckpoints(cwd, sessionId);
  return (existing.at(-1)?.index ?? -1) + 1;
}

/**
 * Snapshot the working tree into `refs/codeden/checkpoints/<session>/<index>` (§9):
 * temporary index -> `write-tree` -> `commit-tree` -> `update-ref`. The parent is the
 * previous checkpoint (or HEAD for the first), so `git log <ref>` walks the turns.
 */
export async function createCheckpoint(
  cwd: string,
  sessionId: string,
  index: number,
  turnId?: string,
): Promise<CheckpointInfo> {
  const tree = await snapshotTree(cwd);
  const parent =
    (index > 0 ? await resolveCommit(cwd, checkpointRef(sessionId, index - 1)) : undefined) ??
    (await resolveCommit(cwd, "HEAD"));
  const message = [
    `CodeBench checkpoint ${index}`,
    "",
    `Session: ${sessionId}`,
    ...(turnId ? [`Turn: ${turnId}`] : []),
  ].join("\n");
  const commit = await gitText(
    cwd,
    ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-F", "-"],
    { env: IDENTITY, input: `${message}\n` },
  );
  const ref = checkpointRef(sessionId, index);
  await git(cwd, ["update-ref", "-m", "codeden checkpoint", ref, commit]);
  return { index, ref, commit, createdAt: new Date().toISOString() };
}

async function checkpointCommit(cwd: string, sessionId: string, index: number): Promise<string> {
  const commit = await resolveCommit(cwd, checkpointRef(sessionId, index));
  if (!commit) {
    throw new CommandError("unknown_checkpoint", `Checkpoint ${index} of ${sessionId} not found`);
  }
  return commit;
}

/** Diff checkpoint `from` against checkpoint `to`, or against the current working tree. */
export async function diffCheckpoints(
  cwd: string,
  sessionId: string,
  from: number,
  to?: number,
): Promise<{ diff: string; files: DiffFileStat[] }> {
  const fromCommit = await checkpointCommit(cwd, sessionId, from);
  const target =
    to === undefined ? await snapshotTree(cwd) : await checkpointCommit(cwd, sessionId, to);
  return diffTrees(cwd, fromCommit, target);
}

/**
 * Make files (all, or those under `paths`) match checkpoint `index`: changed and removed
 * files are written back from the checkpoint through a temporary index
 * (`read-tree` + `checkout-index`), and files that did not exist then are deleted.
 * The user's index and branch are untouched; ignored files are left alone.
 */
export async function restoreFiles(
  cwd: string,
  sessionId: string,
  index: number,
  paths?: string[],
): Promise<{ restored: string[]; deleted: string[] }> {
  const top = await topLevel(cwd);
  const commit = await checkpointCommit(top, sessionId, index);
  const current = await snapshotTree(top);
  const spec = paths && paths.length > 0 ? ["--", ...paths] : [];
  const changes = parseNameStatus(
    (
      await git(top, ["diff", "--name-status", "-z", "--no-renames", current, commit, ...spec], {
        env: { GIT_LITERAL_PATHSPECS: "1" },
      })
    ).stdout,
  );
  const restored = changes.filter((c) => c.status !== "deleted").map((c) => c.path);
  const deleted = changes.filter((c) => c.status === "deleted").map((c) => c.path);

  for (const path of deleted) await rm(join(top, path), { force: true });
  if (restored.length > 0) {
    const tmp = join(tmpdir(), `codeden-index-${randomBytes(8).toString("hex")}`);
    try {
      const env = { GIT_INDEX_FILE: tmp };
      await git(top, ["read-tree", commit], { env });
      await git(top, ["checkout-index", "-f", "-z", "--stdin"], {
        env,
        input: `${restored.join("\0")}\0`,
      });
    } finally {
      await rm(tmp, { force: true });
    }
  }
  return { restored, deleted };
}

/** Delete all checkpoint refs of a session. */
export async function deleteCheckpoints(cwd: string, sessionId: string): Promise<void> {
  const refs = (await listCheckpoints(cwd, sessionId)).map((c) => c.ref);
  if (refs.length === 0) return;
  await git(cwd, ["update-ref", "--stdin", "-z"], {
    input: refs.map((r) => `delete ${r}\0\0`).join(""),
  });
}
