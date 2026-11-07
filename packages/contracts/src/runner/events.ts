import { z } from "zod";
import { AgentEvent } from "../agent-events";
import { ErrorInfo, Id } from "../common";
import { PtyId } from "./commands";

/**
 * Durable runner -> server events. Journaled by the runner and delivered with a `seq`
 * until the server acknowledges them (§4.2), so nothing is lost while the server is away.
 */
export const RunnerEvent = z.discriminatedUnion("kind", [
  /** A normalized agent event for a session. */
  z.object({ kind: z.literal("agent"), sessionId: Id, event: AgentEvent }),
  /** Provider process lifecycle for a session. */
  z.object({
    kind: z.literal("session.process"),
    sessionId: Id,
    state: z.enum(["starting", "ready", "exited", "crashed"]),
    exitCode: z.int().nullable().optional(),
    error: ErrorInfo.optional(),
  }),
  /** Output of `workspace.prepare` setup commands. */
  z.object({
    kind: z.literal("workspace.setup"),
    sessionId: Id,
    status: z.enum(["running", "succeeded", "failed"]),
    command: z.string(),
    output: z.string().optional(),
  }),
  z.object({ kind: z.literal("pty.exited"), ptyId: PtyId, exitCode: z.int().nullable() }),
  /** The runner started draining (upgrade/shutdown). */
  z.object({ kind: z.literal("runner.draining"), reason: z.string() }),
]);
export type RunnerEvent = z.infer<typeof RunnerEvent>;
export type RunnerEventKind = RunnerEvent["kind"];

/**
 * Ephemeral runner -> server stream data. Not journaled, no `seq`, no ack: dropping it while
 * the server is away is fine (terminals keep scrollback in the runner).
 */
export const RunnerStream = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pty.output"), ptyId: PtyId, data: z.string() }),
  z.object({
    kind: z.literal("browser.frame"),
    sessionId: Id,
    mediaType: z.enum(["image/jpeg", "image/png"]),
    /** Base64 frame data. */
    data: z.string(),
    width: z.int().positive(),
    height: z.int().positive(),
  }),
]);
export type RunnerStream = z.infer<typeof RunnerStream>;
