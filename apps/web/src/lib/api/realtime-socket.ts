import { type UiClientMessage, UiServerMessage } from "@codeden/contracts";
import type { TranscriptWatchMessage } from "./client";

export type ConnectionState = "connecting" | "open" | "closed";

interface Subscription {
  seq: number;
  listener: (msg: UiServerMessage) => void;
}

interface Watch {
  seq: number;
  listeners: Set<(msg: TranscriptWatchMessage) => void>;
}

/**
 * The UI WebSocket (`/ws`, §6). One socket carries the global domain stream (`subscribe`,
 * agent events off) and per-session transcript watches (`watch_session`). It reconnects with
 * backoff and resumes from the highest seq seen on every stream.
 */
export class RealtimeSocket {
  private ws: WebSocket | undefined;
  private subscription: Subscription | undefined;
  private readonly watches = new Map<string, Watch>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private state: ConnectionState = "closed";
  private delay = 500;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly url: string) {}

  subscribe(fromSeq: number, listener: (msg: UiServerMessage) => void): () => void {
    const sub: Subscription = { seq: fromSeq, listener };
    this.subscription = sub;
    this.ensureOpen();
    this.sendSubscribe();
    return () => {
      if (this.subscription !== sub) return;
      this.subscription = undefined;
      this.send({ type: "unsubscribe" });
      this.closeIfIdle();
    };
  }

  watch(
    sessionId: string,
    fromSeq: number,
    listener: (msg: TranscriptWatchMessage) => void,
  ): () => void {
    let watch = this.watches.get(sessionId);
    if (!watch) {
      watch = { seq: fromSeq, listeners: new Set() };
      this.watches.set(sessionId, watch);
      this.ensureOpen();
      this.send({ type: "watch_session", sessionId, fromSeq });
    } else if (fromSeq < watch.seq) {
      // A fresh snapshot older than the live watch: replay from there for this listener too.
      watch.seq = fromSeq;
      this.send({ type: "watch_session", sessionId, fromSeq });
    }
    watch.listeners.add(listener);
    const current = watch;
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size > 0 || this.watches.get(sessionId) !== current) return;
      this.watches.delete(sessionId);
      this.send({ type: "unwatch_session", sessionId });
      this.closeIfIdle();
    };
  }

  onState(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const l of this.stateListeners) l(state);
  }

  private ensureOpen(): void {
    if (this.ws || this.timer) return;
    this.connect();
  }

  private connect(): void {
    this.timer = undefined;
    this.setState("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.delay = 500;
      this.sendSubscribe();
      for (const [sessionId, w] of this.watches) {
        this.send({ type: "watch_session", sessionId, fromSeq: w.seq });
      }
    };
    ws.onmessage = (event) => this.onMessage(event.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.setState("closed");
      if (!this.subscription && this.watches.size === 0) return;
      this.timer = setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 10_000);
    };
  }

  private onMessage(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      return;
    }
    const parsed = UiServerMessage.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    switch (msg.type) {
      case "hello":
        this.setState("open");
        break;
      case "events": {
        const sub = this.subscription;
        if (sub) for (const e of msg.events) sub.seq = Math.max(sub.seq, e.seq);
        break;
      }
      case "resync":
        if (this.subscription) this.subscription.seq = msg.seq;
        break;
      case "transcript":
      case "transcript_resync": {
        const watch = this.watches.get(msg.sessionId);
        if (!watch) return;
        watch.seq = Math.max(watch.seq, msg.seq);
        for (const l of watch.listeners) l(msg);
        return;
      }
      default:
        break;
    }
    this.subscription?.listener(msg);
  }

  private sendSubscribe(): void {
    if (this.subscription) {
      this.send({ type: "subscribe", fromSeq: this.subscription.seq, agentEvents: false });
    }
  }

  private send(msg: UiClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private closeIfIdle(): void {
    if (this.subscription || this.watches.size > 0) return;
    const ws = this.ws;
    this.ws = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    ws?.close();
    this.setState("closed");
  }
}
