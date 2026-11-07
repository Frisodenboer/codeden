import {
  ClientToServerMessage,
  CODEDEN_VERSION,
  type RawEventEnvelope,
  type RunnerConnectionStatus,
  type ServerToClientMessage,
  UI_PROTOCOL_VERSION,
} from "@codeden/contracts";
import type { WSContext, WSEvents } from "hono/ws";
import type { EventStore } from "../events/store";

/** Clients further behind than this must reload the snapshot instead of replaying. */
const MAX_CATCH_UP = 50_000;
const BATCH = 500;

interface Client {
  ws: WSContext;
  /** Highest seq delivered; `undefined` until subscribed. */
  lastSent: number | undefined;
  sessionIds: Set<string> | undefined;
}

/**
 * UI realtime hub (§6): snapshot seq -> `subscribe { fromSeq }` -> catch-up -> live events.
 * Catch-up and registration happen synchronously, and appends are synchronous too, so no
 * event can slip between catch-up and live delivery.
 */
export class WsHub {
  private readonly clients = new Set<Client>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: EventStore,
    private readonly runnerStatus: () => RunnerConnectionStatus,
  ) {
    this.unsubscribe = store.subscribe((events) => this.broadcast(events));
  }

  /** Handlers for `upgradeWebSocket`. */
  handlers(): WSEvents {
    let client: Client | undefined;
    return {
      onOpen: (_event, ws) => {
        client = { ws, lastSent: undefined, sessionIds: undefined };
        this.clients.add(client);
        send(ws, {
          type: "hello",
          protocolVersion: UI_PROTOCOL_VERSION,
          serverVersion: CODEDEN_VERSION,
          seq: this.store.headSeq(),
        });
        send(ws, { type: "runner", runner: this.runnerStatus() });
      },
      onMessage: (event, ws) => {
        if (!client) return;
        const parsed = ClientToServerMessage.safeParse(safeJson(event.data));
        if (!parsed.success) {
          send(ws, { type: "error", error: { code: "bad_message", message: "Invalid message" } });
          return;
        }
        const msg = parsed.data;
        if (msg.type === "ping") send(ws, { type: "pong", id: msg.id });
        else if (msg.type === "unsubscribe") client.lastSent = undefined;
        else this.subscribe(client, msg.fromSeq, msg.sessionIds);
      },
      onClose: () => {
        if (client) this.clients.delete(client);
      },
    };
  }

  /** Push a runner status change to every client. */
  broadcastRunner(runner: RunnerConnectionStatus): void {
    for (const client of this.clients) send(client.ws, { type: "runner", runner });
  }

  close(): void {
    this.unsubscribe();
    for (const client of this.clients) client.ws.close(1001, "server stopping");
    this.clients.clear();
  }

  private subscribe(client: Client, fromSeq: number, sessionIds?: string[]): void {
    const head = this.store.headSeq();
    if (fromSeq > head) {
      send(client.ws, { type: "resync", reason: "server_restarted", seq: head });
      return;
    }
    if (head - fromSeq > MAX_CATCH_UP) {
      send(client.ws, { type: "resync", reason: "too_far_behind", seq: head });
      return;
    }
    client.sessionIds = sessionIds ? new Set(sessionIds) : undefined;
    let cursor = fromSeq;
    for (;;) {
      const batch = this.store.listAfter(cursor, BATCH, sessionIds);
      if (batch.length === 0) break;
      send(client.ws, { type: "events", events: batch });
      cursor = batch.at(-1)?.seq ?? cursor;
      if (batch.length < BATCH) break;
    }
    client.lastSent = Math.max(cursor, head);
  }

  private broadcast(events: RawEventEnvelope[]): void {
    for (const client of this.clients) {
      const lastSent = client.lastSent;
      if (lastSent === undefined) continue;
      const filter = client.sessionIds;
      const fresh = events.filter(
        (e) => e.seq > lastSent && (!filter || e.sessionId === null || filter.has(e.sessionId)),
      );
      const last = events.at(-1);
      if (last) client.lastSent = Math.max(lastSent, last.seq);
      if (fresh.length > 0) send(client.ws, { type: "events", events: fresh });
    }
  }
}

function send(ws: WSContext, msg: ServerToClientMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function safeJson(data: unknown): unknown {
  try {
    return typeof data === "string" ? JSON.parse(data) : undefined;
  } catch {
    return undefined;
  }
}
