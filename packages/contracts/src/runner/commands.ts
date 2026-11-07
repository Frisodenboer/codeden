import { z } from "zod";
import { Id, ProviderId } from "../common";
import { UserInput } from "../input";
import { ProjectConfigFile } from "../project-config";
import { ProviderStatus, RuntimeResponse, SessionOptions } from "../provider";
import { BrowserCommandResults, BrowserCommands } from "./browser";

/** Terminal (node-pty) id, unique per runner. */
export const PtyId = z.string().min(1).max(100);

/** Index of a turn checkpoint: 0 is the baseline at session start, n the end of turn n. */
export const CheckpointIndex = z.int().nonnegative();

/** Per-file change summary of a diff. */
export const DiffFileStat = z.object({
  path: z.string(),
  /** Previous path for renames and copies. */
  oldPath: z.string().optional(),
  status: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
  additions: z.int().nonnegative(),
  deletions: z.int().nonnegative(),
  binary: z.boolean(),
});
export type DiffFileStat = z.infer<typeof DiffFileStat>;

/**
 * Commands the server sends to a runner (§4.3), discriminated on `name`.
 * Each has a matching result schema in `RunnerCommandResults`.
 */
export const RunnerCommand = z.discriminatedUnion("name", [
  /** Report sessions, terminals and journal state. */
  z.object({ name: z.literal("runner.status") }),
  /** Finish or pause running turns, then stop accepting work (before an upgrade). */
  z.object({
    name: z.literal("runner.drain"),
    reason: z.string(),
    /** Max time to wait for running turns before interrupting them. Default 5 minutes. */
    timeoutMs: z.int().positive().optional(),
    /** Exit the process once drained, so the server starts a fresh runner (upgrades). */
    exitWhenDrained: z.boolean().optional(),
  }),
  /** Runtime configuration pushed by the server after each handshake. */
  z.object({
    name: z.literal("runner.configure"),
    /** Where the local MCP proxy forwards to (the server's `/mcp`); `null` disables it. */
    mcpUpstreamUrl: z.url().nullable(),
  }),
  /** Exit the runner process after closing sessions and terminals. */
  z.object({ name: z.literal("runner.shutdown") }),
  /** Detect installed providers (all when `providerId` is omitted). */
  z.object({ name: z.literal("provider.detect"), providerId: ProviderId.optional() }),
  /** One tool-less utility-model call (§7.4) through a provider's `utilityModel()`. */
  z.object({
    name: z.literal("provider.oneShot"),
    providerId: ProviderId,
    prompt: z.string().min(1),
    system: z.string().optional(),
    /** Provider model id; the provider's small default when omitted. */
    model: z.string().optional(),
    timeoutMs: z.int().positive().max(300_000).optional(),
  }),
  /** Create or reuse the working directory for a session (worktree + setup commands). */
  z.object({
    name: z.literal("workspace.prepare"),
    sessionId: Id,
    repoPath: z.string().min(1),
    strategy: z.enum(["worktree", "repo_root", "existing"]),
    /** Target directory for `worktree` / `existing`. */
    path: z.string().optional(),
    branch: z.string().optional(),
    baseRef: z.string().optional(),
    setupCommands: z.array(z.string()).default([]),
    /** Used for the default worktree path `<home>/wt/<projectSlug>/<sessionShort>`. */
    projectSlug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
      .optional(),
    /** `git fetch origin` before branching (when an `origin` remote exists). */
    fetch: z.boolean().optional(),
    /** Run `.codeden/project.json` `setup` commands before `setupCommands`. Default true. */
    runProjectSetup: z.boolean().optional(),
  }),
  /** Remove a session worktree (and optionally its branch). */
  z.object({
    name: z.literal("workspace.remove"),
    repoPath: z.string().min(1),
    path: z.string().min(1),
    deleteBranch: z.string().optional(),
    /** Remove even with uncommitted changes. */
    force: z.boolean().optional(),
  }),
  /** Open a provider session; optionally start the first turn. */
  z.object({
    name: z.literal("session.start"),
    sessionId: Id,
    providerId: ProviderId,
    options: SessionOptions,
    input: UserInput.optional(),
    /** Snapshot the cwd at session start and every turn end (§9). Default true in git repos. */
    checkpoints: z.boolean().optional(),
  }),
  /** Start a new turn. */
  z.object({ name: z.literal("session.send"), sessionId: Id, input: UserInput }),
  /** Inject input into the running turn (requires `capabilities.steer`). */
  z.object({ name: z.literal("session.steer"), sessionId: Id, input: UserInput }),
  z.object({ name: z.literal("session.interrupt"), sessionId: Id }),
  /** Answer an approval request or user question. */
  z.object({
    name: z.literal("session.respond"),
    sessionId: Id,
    requestId: Id,
    response: RuntimeResponse,
  }),
  /** Close the provider session (resumable later via its resume token). */
  z.object({ name: z.literal("session.stop"), sessionId: Id }),
  z.object({
    name: z.literal("pty.open"),
    ptyId: PtyId,
    cwd: z.string().min(1),
    shell: z.string().optional(),
    args: z.array(z.string()).optional(),
    cols: z.int().positive(),
    rows: z.int().positive(),
    env: z.record(z.string(), z.string()).optional(),
    sessionId: Id.optional(),
  }),
  z.object({ name: z.literal("pty.input"), ptyId: PtyId, data: z.string() }),
  z.object({
    name: z.literal("pty.resize"),
    ptyId: PtyId,
    cols: z.int().positive(),
    rows: z.int().positive(),
  }),
  z.object({ name: z.literal("pty.close"), ptyId: PtyId }),
  /** Scrollback and state of a terminal, for (re)attaching a view. */
  z.object({ name: z.literal("pty.attach"), ptyId: PtyId }),
  /** `browser.*` (§12.2), defined in `./browser`. */
  ...BrowserCommands,
  /** Snapshot the worktree into `refs/codeden/checkpoints/<session>/<n>` (§9). */
  z.object({
    name: z.literal("git.checkpoint"),
    sessionId: Id,
    cwd: z.string(),
    index: z.int().nonnegative(),
  }),
  z.object({ name: z.literal("git.status"), cwd: z.string() }),
  /** Unified diff `fromRef..toRef`; without `toRef`, against the working tree incl. untracked files. */
  z.object({
    name: z.literal("git.diff"),
    cwd: z.string(),
    fromRef: z.string(),
    toRef: z.string().optional(),
  }),
  z.object({
    name: z.literal("git.branches"),
    cwd: z.string(),
    includeRemote: z.boolean().optional(),
  }),
  /** Stage (all changes, or `paths`) and commit. */
  z.object({
    name: z.literal("git.commit"),
    cwd: z.string(),
    message: z.string().min(1),
    paths: z.array(z.string()).optional(),
  }),
  z.object({
    name: z.literal("git.push"),
    cwd: z.string(),
    /** Default `origin`. */
    remote: z.string().optional(),
    /** Default: the current branch. */
    branch: z.string().optional(),
    /** Set the upstream (`-u`). Default true. */
    setUpstream: z.boolean().optional(),
    forceWithLease: z.boolean().optional(),
  }),
  z.object({ name: z.literal("checkpoint.list"), cwd: z.string(), sessionId: Id }),
  /** Diff between two checkpoints; without `to`, against the current working tree. */
  z.object({
    name: z.literal("checkpoint.diff"),
    cwd: z.string(),
    sessionId: Id,
    from: CheckpointIndex,
    to: CheckpointIndex.optional(),
  }),
  /** Restore files (all, or `paths`) to their state at a checkpoint without touching the index. */
  z.object({
    name: z.literal("checkpoint.restoreFiles"),
    cwd: z.string(),
    sessionId: Id,
    index: CheckpointIndex,
    paths: z.array(z.string()).optional(),
  }),
  /** Listening localhost ports of processes started by this runner, plus `probe`d ports. */
  z.object({
    name: z.literal("ports.list"),
    probe: z.array(z.int().min(1).max(65535)).optional(),
  }),
]);
export type RunnerCommand = z.infer<typeof RunnerCommand>;
export type RunnerCommandName = RunnerCommand["name"];
export type RunnerCommandOf<N extends RunnerCommandName> = Extract<RunnerCommand, { name: N }>;

/** A session currently hosted by the runner. */
export const RunnerSessionInfo = z.object({
  sessionId: Id,
  providerId: ProviderId,
  state: z.enum(["idle", "running", "closing"]),
  resumeToken: z.string().nullable(),
});
export type RunnerSessionInfo = z.infer<typeof RunnerSessionInfo>;

const Empty = z.object({});

/** Result schema for each command. */
export const RunnerCommandResults = {
  "runner.status": z.object({
    sessions: z.array(RunnerSessionInfo),
    ptys: z.array(PtyId),
    journal: z.object({ lastSeq: z.int().nonnegative(), unacked: z.int().nonnegative() }),
    draining: z.boolean(),
  }),
  "runner.drain": Empty,
  "runner.configure": z.object({ mcpProxyUrl: z.string().nullable() }),
  "runner.shutdown": Empty,
  "provider.detect": z.object({ statuses: z.array(ProviderStatus) }),
  "provider.oneShot": z.object({ text: z.string(), model: z.string() }),
  "workspace.prepare": z.object({
    cwd: z.string(),
    branch: z.string().nullable(),
    created: z.boolean(),
    /** Parsed `.codeden/project.json`, when present and valid. */
    config: ProjectConfigFile.nullable().optional(),
    /** Setup commands that ran, in order (stops at the first failure). */
    setup: z
      .array(z.object({ command: z.string(), exitCode: z.int().nullable(), ok: z.boolean() }))
      .optional(),
  }),
  "workspace.remove": z.object({ removed: z.boolean() }),
  "session.start": z.object({ resumeToken: z.string().nullable() }),
  "session.send": Empty,
  "session.steer": Empty,
  "session.interrupt": Empty,
  "session.respond": Empty,
  "session.stop": Empty,
  "pty.open": z.object({ pid: z.int() }),
  "pty.input": Empty,
  "pty.resize": Empty,
  "pty.close": Empty,
  "pty.attach": z.object({
    pid: z.int(),
    cols: z.int().positive(),
    rows: z.int().positive(),
    /** Bounded scrollback to replay into a fresh view. */
    scrollback: z.string(),
    exited: z.boolean(),
    exitCode: z.int().nullable(),
  }),
  ...BrowserCommandResults,
  "git.checkpoint": z.object({ ref: z.string(), commit: z.string() }),
  "git.status": z.object({
    branch: z.string().nullable(),
    ahead: z.int().nonnegative(),
    behind: z.int().nonnegative(),
    files: z.array(z.object({ path: z.string(), status: z.string() })),
  }),
  "git.diff": z.object({ diff: z.string(), files: z.array(DiffFileStat).optional() }),
  "git.branches": z.object({
    current: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    branches: z.array(
      z.object({
        name: z.string(),
        remote: z.boolean(),
        commit: z.string(),
        upstream: z.string().nullable(),
      }),
    ),
  }),
  /** `commit` is null when there was nothing to commit. */
  "git.commit": z.object({ commit: z.string().nullable() }),
  "git.push": z.object({ remote: z.string(), branch: z.string() }),
  "checkpoint.list": z.object({
    checkpoints: z.array(
      z.object({
        index: CheckpointIndex,
        ref: z.string(),
        commit: z.string(),
        createdAt: z.string(),
      }),
    ),
  }),
  "checkpoint.diff": z.object({ diff: z.string(), files: z.array(DiffFileStat) }),
  "checkpoint.restoreFiles": z.object({
    restored: z.array(z.string()),
    deleted: z.array(z.string()),
  }),
  "ports.list": z.object({
    ports: z.array(
      z.object({
        port: z.int().min(1).max(65535),
        pid: z.int().nullable(),
        url: z.string(),
      }),
    ),
  }),
} satisfies Record<RunnerCommandName, z.ZodType>;

/** Result type of a command: `RunnerCommandResult<"session.start">`. */
export type RunnerCommandResult<N extends RunnerCommandName> = z.infer<
  (typeof RunnerCommandResults)[N]
>;
