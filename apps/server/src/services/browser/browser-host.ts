import { randomUUID } from "node:crypto";
import {
  BrowserHostClientMessage,
  type BrowserHostServerMessage,
  type BrowserRelayEndpoint,
} from "@codeden/contracts";
import type { WSContext, WSEvents } from "hono/ws";

type HandoffSessions = Extract<BrowserHostClientMessage, { type: "handoff" }>["sessions"];

export interface BrowserHostDeps {
  /** Move sessions to the runner's Chromium; resolves with the ids that failed. */
  handoff: (sessions: HandoffSessions) => Promise<string[]>;
  log?: (message: string) => void;
}

const ATTACH_TIMEOUT_MS = 10_000;

interface Waiting {
  resolve: (relay: BrowserRelayEndpoint) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * The desktop app's offer of native browser views (§17 Phase 2), over `/ws/browser-host`
 * (loopback only, install token). One app runs per home, so the latest app to connect is the
 * host. The server asks it to `attach` a session and gets that session's relay back; when the
 * app quits it hands its open sessions to the runner through here.
 */
export class BrowserHostLink {
  private host: { ws: WSContext; version: string } | null = null;
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly deps: BrowserHostDeps) {}

  /** A desktop app is connected and can host native views. */
  get available(): boolean {
    return this.host !== null && this.host.ws.readyState === 1;
  }

  /** Ask the app for a session's native browser; rejects when no app answers in time. */
  attach(sessionId: string, timeoutMs = ATTACH_TIMEOUT_MS): Promise<BrowserRelayEndpoint> {
    const ws = this.host?.ws;
    if (ws?.readyState !== 1) return Promise.reject(new Error("No desktop app is connected"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("The desktop app did not answer"));
      }, timeoutMs);
      timer.unref?.();
      this.waiting.set(id, { resolve, reject, timer });
      send(ws, { type: "attach", id, sessionId });
    });
  }

  handlers(): WSEvents {
    let ws: WSContext | undefined;
    return {
      onOpen: (_event, socket) => {
        ws = socket;
      },
      onMessage: (event) => {
        if (!ws) return;
        let msg: BrowserHostClientMessage;
        try {
          msg = BrowserHostClientMessage.parse(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        void this.handle(ws, msg);
      },
      onClose: () => {
        if (ws && this.host?.ws === ws) {
          this.host = null;
          this.deps.log?.("browser host: the desktop app disconnected");
          for (const [id, w] of this.waiting) {
            clearTimeout(w.timer);
            w.reject(new Error("The desktop app disconnected"));
            this.waiting.delete(id);
          }
        }
      },
    };
  }

  private async handle(ws: WSContext, msg: BrowserHostClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        if (this.host && this.host.ws !== ws) this.host.ws.close(1000, "replaced");
        this.host = { ws, version: msg.version };
        this.deps.log?.(`browser host: desktop app ${msg.version} offers native views`);
        return;
      case "attached":
      case "failed": {
        const w = this.waiting.get(msg.id);
        if (!w) return;
        this.waiting.delete(msg.id);
        clearTimeout(w.timer);
        if (msg.type === "attached") w.resolve(msg.relay);
        else w.reject(new Error(msg.message));
        return;
      }
      case "handoff": {
        const failed = await this.deps.handoff(msg.sessions).catch((error: unknown) => {
          this.deps.log?.(`browser host: hand-off failed: ${String(error)}`);
          return msg.sessions.map((s) => s.sessionId);
        });
        send(ws, { type: "handoff.done", id: msg.id, failed });
      }
    }
  }
}

function send(ws: WSContext, msg: BrowserHostServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
