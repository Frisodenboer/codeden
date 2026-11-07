import { z } from "zod";
import { ErrorInfo, Id, Timestamp } from "./common";
import { Automation } from "./entities/automation";
import { InboxItem } from "./entities/inbox";
import { Project } from "./entities/project";
import { ItemRecord, Session, Thread, Turn } from "./entities/session";
import { RawEventEnvelope } from "./events";
import { RoleSessionsRef } from "./orchestration";
import { ProviderInfo } from "./provider";
import { Settings } from "./settings";
import { ScheduledRun } from "./work";

/**
 * Server <-> UI realtime protocol (§6 "Realtime to the UI").
 *
 * 1. The client loads a `Snapshot` over HTTP (`GET /api/snapshot`); it includes the current `seq`.
 * 2. It opens `/ws` and sends `subscribe { fromSeq: snapshot.seq }`.
 * 3. The server sends every event with `seq > fromSeq` (catch-up), then live `events` batches.
 * 4. On reconnect the client subscribes from the last `seq` it applied.
 * 5. If the server cannot serve the gap, it sends `resync`; the client reloads the snapshot.
 */

/** Runner connection state as seen by the server. */
export const RunnerConnectionStatus = z.object({
  state: z.enum(["disabled", "starting", "connected", "disconnected", "incompatible"]),
  runnerId: z.string().nullable(),
  version: z.string().nullable(),
  providers: z.array(ProviderInfo),
  lastError: z.string().nullable(),
});
export type RunnerConnectionStatus = z.infer<typeof RunnerConnectionStatus>;

/** Everything the app shell needs on load. Transcripts are loaded per session. */
export const Snapshot = z.object({
  seq: z.int().nonnegative(),
  serverVersion: z.string(),
  generatedAt: Timestamp,
  settings: Settings,
  projects: z.array(Project),
  sessions: z.array(Session),
  inbox: z.array(InboxItem),
  automations: z.array(Automation),
  /** Upcoming scheduled runs across projects (§8.4 Now / Next). */
  scheduled: z.array(ScheduledRun).default([]),
  /** The orchestrator and PM sessions (§8.1), also present in `sessions`. */
  roleSessions: RoleSessionsRef.optional(),
  runner: RunnerConnectionStatus,
});
export type Snapshot = z.infer<typeof Snapshot>;

/** One session's transcript (`GET /api/sessions/:id/snapshot`). */
export const SessionSnapshot = z.object({
  seq: z.int().nonnegative(),
  session: Session,
  threads: z.array(Thread),
  turns: z.array(Turn),
  items: z.array(ItemRecord),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

// ---------------------------------------------------------------- client -> server

export const ClientSubscribe = z.object({
  type: z.literal("subscribe"),
  /** Deliver events with `seq > fromSeq`. */
  fromSeq: z.int().nonnegative(),
  /** Restrict to these sessions (plus global events); omitted means everything. */
  sessionIds: z.array(Id).optional(),
});

export const ClientToServerMessage = z.discriminatedUnion("type", [
  ClientSubscribe,
  z.object({ type: z.literal("unsubscribe") }),
  z.object({ type: z.literal("ping"), id: z.string() }),
]);
export type ClientToServerMessage = z.infer<typeof ClientToServerMessage>;

// ---------------------------------------------------------------- server -> client

export const ServerToClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocolVersion: z.int().positive(),
    serverVersion: z.string(),
    /** Current head of the event log. */
    seq: z.int().nonnegative(),
  }),
  /**
   * Ordered batch of events. Payloads are sent raw; parse with `EventEnvelope` and skip
   * unknown types so older clients survive newer servers.
   */
  z.object({ type: z.literal("events"), events: z.array(RawEventEnvelope) }),
  /** The client must reload its snapshot and resubscribe from `seq`. */
  z.object({
    type: z.literal("resync"),
    reason: z.enum(["gap", "too_far_behind", "server_restarted"]),
    seq: z.int().nonnegative(),
  }),
  /** Runner connection changed (ephemeral; not in the event log). */
  z.object({ type: z.literal("runner"), runner: RunnerConnectionStatus }),
  z.object({ type: z.literal("pong"), id: z.string() }),
  z.object({ type: z.literal("error"), error: ErrorInfo }),
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientMessage>;

/** `GET /api/health` response (unauthenticated, used by the CLI to find a running server). */
export const HealthResponse = z.object({
  ok: z.literal(true),
  name: z.literal("codeden"),
  version: z.string(),
  uptimeSec: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
