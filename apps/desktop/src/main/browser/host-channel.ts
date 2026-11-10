import { randomUUID } from "node:crypto";
import {
  type BrowserHostClientMessage,
  BrowserHostServerMessage,
  type BrowserRelayEndpoint,
} from "@codeden/contracts";
import WebSocket from "ws";

export interface HostChannelOptions {
  /** `http://127.0.0.1:<port>` of the server. */
  baseUrl: string;
  token: string;
  version: string;
  attach: (sessionId: string) => Promise<BrowserRelayEndpoint>;
  log: (message: string) => void;
}

type HandoffSessions = Extract<BrowserHostClientMessage, { type: "handoff" }>["sessions"];

/** Reconnect delays; an older server without the channel ends up asked twice a minute. */
const RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * The app's side of `/ws/browser-host` (§17 Phase 2): tells the server this app can host
 * native browser views, answers its `attach` requests with a session's relay, and hands the
 * open sessions to the runner when the app quits. Reconnects while the app runs (the server
 * may restart); the install token never leaves loopback.
 */
export class HostChannel {
  private ws: WebSocket | undefined;
  private stopped = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly waiting = new Map<string, (failed: string[]) => void>();

  constructor(private readonly opts: HostChannelOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Ask the server to move these sessions to the runner's Chromium. Resolves with the sessions
   * it could not move, or null when the server did not answer in time.
   */
  handoff(sessions: HandoffSessions, timeoutMs: number): Promise<string[] | null> {
    const ws = this.ws;
    if (sessions.length === 0) return Promise.resolve([]);
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve(null);
      }, timeoutMs);
      this.waiting.set(id, (failed) => {
        clearTimeout(timer);
        resolve(failed);
      });
      this.send({ type: "handoff", id, sessions });
    });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = `${this.opts.baseUrl.replace(/^http/, "ws")}/ws/browser-host`;
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.opts.token}` },
      perMessageDeflate: false,
    });
    this.ws = ws;
    ws.on("open", () => {
      this.attempt = 0;
      this.send({ type: "hello", version: this.opts.version });
      this.opts.log("browser: offering native views to the server");
    });
    ws.on("message", (data) => void this.onMessage(String(data)));
    ws.on("error", () => undefined);
    ws.on("close", () => {
      if (this.ws === ws) this.ws = undefined;
      for (const done of this.waiting.values()) done([]);
      this.waiting.clear();
      if (this.stopped) return;
      const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)] ?? 30_000;
      this.attempt++;
      this.timer = setTimeout(() => this.connect(), delay);
      this.timer.unref?.();
    });
  }

  private async onMessage(raw: string): Promise<void> {
    let parsed: BrowserHostServerMessage;
    try {
      parsed = BrowserHostServerMessage.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if (parsed.type === "handoff.done") {
      this.waiting.get(parsed.id)?.(parsed.failed);
      this.waiting.delete(parsed.id);
      return;
    }
    try {
      const relay = await this.opts.attach(parsed.sessionId);
      this.send({ type: "attached", id: parsed.id, relay });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send({ type: "failed", id: parsed.id, message });
    }
  }

  private send(message: BrowserHostClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
