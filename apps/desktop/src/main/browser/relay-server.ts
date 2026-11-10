import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { BROWSER_RELAY_SECRET_HEADER } from "@codeden/contracts";
import { WebSocketServer } from "ws";
import type { CdpRelay } from "./relay";

/** The relay a session id and secret open, or null to refuse. */
export type RelayLookup = (sessionId: string) => { relay: CdpRelay; secret: string } | null;

/** Path of a session's relay: `/cdp/<sessionId>`. */
const PATH = /^\/cdp\/([A-Za-z0-9_-]{1,200})$/;

/**
 * True when an upgrade request may reach a session's relay: the right path and secret, from a
 * loopback peer, and not from a web page (browsers always send `Origin`; the runner never
 * does, so no page on the machine can reach a relay even if it guessed the port).
 */
export function acceptRelayRequest(
  req: Pick<IncomingMessage, "url" | "headers"> & { socket: { remoteAddress?: string } },
  lookup: RelayLookup,
): { relay: CdpRelay } | null {
  const match = PATH.exec(new URL(req.url ?? "/", "http://relay").pathname);
  if (!match?.[1] || req.headers.origin !== undefined) return null;
  if (!isLoopback(req.socket.remoteAddress)) return null;
  const entry = lookup(match[1]);
  const given = req.headers[BROWSER_RELAY_SECRET_HEADER];
  if (!entry || typeof given !== "string" || !sameSecret(given, entry.secret)) return null;
  return { relay: entry.relay };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1" || address === "::1";
}

/**
 * The loopback WebSocket server the runner reaches native views through (§17 Phase 2). One
 * listener for the app, one path per CodeDen session, a secret per session in a header. It
 * starts on the first attach and listens on 127.0.0.1 only.
 */
export class RelayServer {
  private server: Server | undefined;
  private starting: Promise<number> | undefined;
  private readonly wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 32 * 1024 * 1024,
  });

  constructor(
    private readonly lookup: RelayLookup,
    private readonly log: (message: string) => void,
  ) {}

  /** The listening port (starts the listener on first use). */
  port(): Promise<number> {
    this.starting ??= new Promise<number>((resolve, reject) => {
      const server = createServer((_req, res) => {
        res.statusCode = 404;
        res.end();
      });
      server.on("upgrade", (req, socket, head) => this.upgrade(req, socket as Socket, head));
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
    return this.starting;
  }

  close(): void {
    for (const client of this.wss.clients) client.terminate();
    this.server?.close();
    this.server = undefined;
    this.starting = undefined;
  }

  private upgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const accepted = acceptRelayRequest(req, this.lookup);
    if (!accepted) {
      this.log("browser: refused a relay connection");
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const connection = accepted.relay.connect({
        send: (data) => {
          if (ws.readyState === ws.OPEN) ws.send(data);
        },
        close: () => ws.close(),
      });
      ws.on("message", (data) => connection.receive(String(data)));
      ws.on("close", () => connection.close());
      ws.on("error", () => ws.terminate());
    });
  }
}
