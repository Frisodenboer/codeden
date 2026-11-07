import { randomUUID } from "node:crypto";
import {
  BrowserClientMessage,
  type BrowserScreencastSettings,
  type BrowserServerMessage,
  type BrowserTab,
  type BrowserWsQuery,
  type RunnerStream,
} from "@codeden/contracts";
import type { WSContext, WSEvents } from "hono/ws";
import { type BrowserService, isBrowserNotOpen } from "../services/browser/browser-service";
import { errorMessage, ServiceError } from "../services/errors";

/** Skip frames for a socket that has this much unsent data (slow client). */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

interface Viewer {
  id: string;
  ws: WSContext;
  sessionId: string;
  /** The viewer wants frames (default true); it watches as soon as the browser is open. */
  wantsWatch: boolean;
  /** Registered with the runner's screencast. */
  watching: boolean;
  open: boolean;
  settings: BrowserScreencastSettings;
  closed: boolean;
}

export interface BrowserBridgeDeps {
  browser: BrowserService;
  log?: (message: string) => void;
}

/**
 * The `/ws/browser` channel (§12.2): one socket is one viewer of one session's browser.
 * Relays the runner's `browser.frame` and `browser.tabs` stream data for that session,
 * forwards human input, and registers the viewer with the runner's screencast, so the
 * screencast runs only while somebody watches.
 */
export class BrowserBridge {
  private readonly viewers = new Map<string, Set<Viewer>>();

  constructor(private readonly deps: BrowserBridgeDeps) {}

  handlers(query: BrowserWsQuery): WSEvents {
    let viewer: Viewer | undefined;
    return {
      onOpen: (_event, ws) => {
        const { sessionId, open: _open, ...settings } = query;
        viewer = {
          id: `ui-${randomUUID()}`,
          ws,
          sessionId,
          wantsWatch: true,
          watching: false,
          open: false,
          settings,
          closed: false,
        };
        this.add(viewer);
        const v = viewer;
        void this.start(v, query.open === "1").catch((error: unknown) => this.fail(v, error));
      },
      onMessage: (event) => {
        if (!viewer) return;
        const v = viewer;
        let msg: BrowserClientMessage;
        try {
          msg = BrowserClientMessage.parse(JSON.parse(String(event.data)));
        } catch {
          return send(v.ws, { type: "error", code: "bad_message", message: "Invalid message" });
        }
        void this.handle(v, msg).catch((error: unknown) => this.fail(v, error));
      },
      onClose: () => {
        if (!viewer) return;
        viewer.closed = true;
        this.remove(viewer);
        if (viewer.watching) void this.setWatching(viewer, false).catch(() => undefined);
      },
    };
  }

  /** Runner stream data: frames and tab updates go to the session's viewers. */
  onStream(stream: RunnerStream): void {
    if (stream.kind === "browser.frame") {
      const { sessionId: _s, kind: _k, ...frame } = stream;
      for (const v of this.viewers.get(stream.sessionId) ?? []) {
        if (!v.watching || buffered(v.ws) > MAX_BUFFERED_BYTES) continue;
        send(v.ws, { type: "frame", ...frame });
      }
      return;
    }
    if (stream.kind === "browser.tabs") {
      for (const v of this.viewers.get(stream.sessionId) ?? []) {
        if (!v.open) {
          // The agent (or another viewer) just opened the browser: start watching.
          v.open = true;
          void this.watchIfWanted(v, stream.tabs).catch((error: unknown) => this.fail(v, error));
        } else {
          send(v.ws, { type: "tabs", tabs: stream.tabs });
        }
      }
    }
  }

  /** Number of viewers per session (diagnostics and tests). */
  viewerCount(sessionId: string): number {
    return this.viewers.get(sessionId)?.size ?? 0;
  }

  private async start(v: Viewer, openNow: boolean): Promise<void> {
    if (openNow) {
      const opened = await this.deps.browser.open(v.sessionId);
      v.open = true;
      return this.watchIfWanted(v, opened.tabs);
    }
    const { open, tabs } = await this.deps.browser.tabs(v.sessionId);
    v.open = v.open || open;
    if (!v.open) return this.sendState(v, []);
    return this.watchIfWanted(v, tabs);
  }

  private async handle(v: Viewer, msg: BrowserClientMessage): Promise<void> {
    const { browser } = this.deps;
    switch (msg.type) {
      case "input":
        await browser.command({ name: "browser.input", sessionId: v.sessionId, input: msg.input });
        return;
      case "watch":
        v.wantsWatch = true;
        if (msg.settings) v.settings = { ...v.settings, ...msg.settings };
        if (v.open) await this.setWatching(v, true);
        return this.sendState(v, (await browser.tabs(v.sessionId)).tabs);
      case "unwatch":
        v.wantsWatch = false;
        if (v.watching) await this.setWatching(v, false);
        return this.sendState(v, (await browser.tabs(v.sessionId)).tabs);
      case "open": {
        const opened = await browser.open(v.sessionId, msg.url);
        v.open = true;
        return this.watchIfWanted(v, opened.tabs);
      }
    }
  }

  private async watchIfWanted(v: Viewer, tabs: BrowserTab[]): Promise<void> {
    if (v.wantsWatch && !v.watching) await this.setWatching(v, true);
    this.sendState(v, tabs);
  }

  private async setWatching(v: Viewer, watching: boolean): Promise<void> {
    try {
      await this.deps.browser.command({
        name: "browser.screencast",
        sessionId: v.sessionId,
        viewerId: v.id,
        watching: watching && !v.closed,
        ...v.settings,
      });
      v.watching = watching && !v.closed;
    } catch (error) {
      if (!isBrowserNotOpen(error)) throw error;
      // The browser closed under us (session stopped): wait for it to open again.
      v.open = false;
      v.watching = false;
      this.sendState(v, []);
    }
  }

  private sendState(v: Viewer, tabs: BrowserTab[]): void {
    send(v.ws, { type: "state", viewerId: v.id, open: v.open, watching: v.watching, tabs });
  }

  private fail(v: Viewer, error: unknown): void {
    const code = error instanceof ServiceError ? error.code : "browser_error";
    send(v.ws, { type: "error", code, message: errorMessage(error) });
  }

  private add(v: Viewer): void {
    const set = this.viewers.get(v.sessionId) ?? new Set();
    set.add(v);
    this.viewers.set(v.sessionId, set);
  }

  private remove(v: Viewer): void {
    const set = this.viewers.get(v.sessionId);
    set?.delete(v);
    if (set?.size === 0) this.viewers.delete(v.sessionId);
  }
}

function buffered(ws: WSContext): number {
  const raw = ws.raw as { bufferedAmount?: number } | undefined;
  return raw?.bufferedAmount ?? 0;
}

function send(ws: WSContext, msg: BrowserServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
