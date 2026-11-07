import { z } from "zod";
import { Id, ProviderId } from "../common";
import { UserInput } from "../input";
import { ProviderStatus, RuntimeResponse, SessionOptions } from "../provider";

/** Terminal (node-pty) id, unique per runner. */
export const PtyId = z.string().min(1).max(100);

/**
 * Commands the server sends to a runner (§4.3), discriminated on `name`.
 * Each has a matching result schema in `RunnerCommandResults`.
 */
export const RunnerCommand = z.discriminatedUnion("name", [
  /** Report sessions, terminals and journal state. */
  z.object({ name: z.literal("runner.status") }),
  /** Finish or pause running turns, then stop accepting work (before an upgrade). */
  z.object({ name: z.literal("runner.drain"), reason: z.string() }),
  /** Exit the runner process after closing sessions and terminals. */
  z.object({ name: z.literal("runner.shutdown") }),
  /** Detect installed providers (all when `providerId` is omitted). */
  z.object({ name: z.literal("provider.detect"), providerId: ProviderId.optional() }),
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
  }),
  /** Open a provider session; optionally start the first turn. */
  z.object({
    name: z.literal("session.start"),
    sessionId: Id,
    providerId: ProviderId,
    options: SessionOptions,
    input: UserInput.optional(),
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
  /** Open (or reuse) the session's browser context. */
  z.object({ name: z.literal("browser.open"), sessionId: Id, url: z.string().optional() }),
  z.object({ name: z.literal("browser.navigate"), sessionId: Id, url: z.string() }),
  z.object({ name: z.literal("browser.close"), sessionId: Id }),
  /** Snapshot the worktree into `refs/codeden/checkpoints/<session>/<n>` (§9). */
  z.object({
    name: z.literal("git.checkpoint"),
    sessionId: Id,
    cwd: z.string(),
    index: z.int().nonnegative(),
  }),
  z.object({ name: z.literal("git.status"), cwd: z.string() }),
  z.object({
    name: z.literal("git.diff"),
    cwd: z.string(),
    fromRef: z.string(),
    toRef: z.string().optional(),
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
  "runner.shutdown": Empty,
  "provider.detect": z.object({ statuses: z.array(ProviderStatus) }),
  "workspace.prepare": z.object({
    cwd: z.string(),
    branch: z.string().nullable(),
    created: z.boolean(),
  }),
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
  "browser.open": z.object({ cdpUrl: z.string().nullable() }),
  "browser.navigate": Empty,
  "browser.close": Empty,
  "git.checkpoint": z.object({ ref: z.string(), commit: z.string() }),
  "git.status": z.object({
    branch: z.string().nullable(),
    ahead: z.int().nonnegative(),
    behind: z.int().nonnegative(),
    files: z.array(z.object({ path: z.string(), status: z.string() })),
  }),
  "git.diff": z.object({ diff: z.string() }),
} satisfies Record<RunnerCommandName, z.ZodType>;

/** Result type of a command: `RunnerCommandResult<"session.start">`. */
export type RunnerCommandResult<N extends RunnerCommandName> = z.infer<
  (typeof RunnerCommandResults)[N]
>;
