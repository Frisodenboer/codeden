import { RelayConnection } from "./relay-connection";

/** CDP params and results are plain JSON objects. */
export type Json = Record<string, unknown>;

/** One native view (a tab) as the relay sees it. */
export interface RelayTarget {
  /** The page's own CDP target id (its main frame id). */
  readonly targetId: string;
  /** The tab that opened this one (popups), for `window.opener` bookkeeping. */
  readonly openerId?: string;
  /** True once the view is closed or its debugger detached. */
  readonly gone: boolean;
  url(): string;
  title(): string;
  /** Send a CDP command to the page, or to one of its child sessions (frames, workers). */
  send(method: string, params: Json | undefined, childSessionId?: string): Promise<unknown>;
  /** CDP events from the page and its child sessions. */
  onEvent(listener: (method: string, params: Json, childSessionId?: string) => void): () => void;
  onGone(listener: () => void): () => void;
}

/** One session's views: everything a relay may see and do. Never the CodeDen window. */
export interface RelayHost {
  targets(): RelayTarget[];
  /** Open a new tab (Electron can't create targets over CDP, so the app does it). */
  createTarget(url: string): Promise<RelayTarget>;
  closeTarget(target: RelayTarget): Promise<void>;
  /** Make the tab the one the panel shows. */
  activateTarget(target: RelayTarget): void;
  /** Tabs opened by the app (popups, a new tab from the panel). */
  onTargetAdded(listener: (target: RelayTarget) => void): () => void;
}

/** The relay's end of one client connection (a WebSocket in the app, a fake in tests). */
export interface RelaySocket {
  send(data: string): void;
  close(): void;
}

export interface RelayOptions {
  /** `Chrome/<version>` for `Browser.getVersion`. */
  product: string;
  userAgent: string;
  /** Captures of a view can stall (a view without a frame); fail them after this long. */
  captureTimeoutMs?: number;
  /** A client connected or left. */
  onConnections?: (count: number) => void;
}

/**
 * The per-session CDP relay (§17 Phase 2). It looks like a browser endpoint to a CDP client
 * (the runner's playwright-core `connectOverCDP`), but it only knows one session's views:
 *
 * - browser-level `Target.*` / `Browser.*` calls are answered here (auto-attach with flattened
 *   sessions, creating and closing tabs through the app, extra sessions for `newCDPSession`);
 * - everything sent on a page session goes to that view's `webContents.debugger`, and its
 *   events come back on every session attached to it;
 * - when a view goes away, commands still waiting on it fail at once instead of hanging.
 */
export class CdpRelay {
  private readonly connections = new Set<RelayConnection>();
  private readonly stopAdded: () => void;

  constructor(
    private readonly host: RelayHost,
    private readonly opts: RelayOptions,
  ) {
    this.stopAdded = host.onTargetAdded((target) => {
      for (const c of this.connections) c.targetAdded(target);
    });
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** A client connected: feed its messages to `receive` and call `close` when it goes. */
  connect(socket: RelaySocket): { receive(data: string): void; close(): void } {
    const connection = new RelayConnection(socket, this.host, this.opts);
    this.connections.add(connection);
    this.opts.onConnections?.(this.connections.size);
    return {
      receive: (data) => connection.receive(data),
      close: () => {
        if (!this.connections.delete(connection)) return;
        connection.dispose();
        this.opts.onConnections?.(this.connections.size);
      },
    };
  }

  /** Drop every client (the session's browser is being torn down or handed off). */
  disconnectAll(): void {
    for (const c of this.connections) c.socket.close();
  }

  dispose(): void {
    this.stopAdded();
    this.disconnectAll();
  }
}
