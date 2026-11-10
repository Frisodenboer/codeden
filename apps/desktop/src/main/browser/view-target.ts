import type { WebContents } from "electron";
import type { RelayTarget } from "./relay";

type Json = Record<string, unknown>;
type EventListener = (method: string, params: Json, childSessionId?: string) => void;

/**
 * A native view's page as a relay target: CDP through the view's own `webContents.debugger`
 * (one per view, shared by every relay session on it). Commands still pending when the view
 * is destroyed or its debugger detaches are rejected, so nothing waits forever.
 */
export class ViewTarget implements RelayTarget {
  private id = "";
  private isGone = false;
  private readonly events = new Set<EventListener>();
  private readonly goneListeners = new Set<() => void>();
  private readonly pending = new Set<(error: Error) => void>();

  constructor(
    readonly contents: WebContents,
    readonly openerId: string | undefined,
    private readonly log: (message: string) => void,
  ) {
    const dbg = contents.debugger;
    dbg.on("message", (_event, method, params, sessionId) => {
      for (const l of this.events) l(method, (params ?? {}) as Json, sessionId || undefined);
    });
    dbg.on("detach", (_event, reason) => {
      this.log(`browser: debugger detached from ${this.id || "a view"} (${reason})`);
      this.markGone();
    });
    contents.once("destroyed", () => this.markGone());
  }

  /** Attach the debugger and learn the page's target id. The view must have loaded a page. */
  async attach(): Promise<void> {
    this.contents.debugger.attach("1.3");
    const { targetInfo } = (await this.contents.debugger.sendCommand("Target.getTargetInfo")) as {
      targetInfo: { targetId: string };
    };
    this.id = targetInfo.targetId;
  }

  get targetId(): string {
    return this.id;
  }

  get gone(): boolean {
    return this.isGone || this.contents.isDestroyed();
  }

  url(): string {
    return this.gone ? "" : this.contents.getURL();
  }

  title(): string {
    return this.gone ? "" : this.contents.getTitle();
  }

  send(method: string, params: Json | undefined, childSessionId?: string): Promise<unknown> {
    if (this.gone) return Promise.reject(new Error("Target closed"));
    return new Promise((resolve, reject) => {
      const abort = (error: Error) => reject(error);
      this.pending.add(abort);
      this.contents.debugger
        .sendCommand(method, params, childSessionId)
        .then(resolve, reject)
        .finally(() => this.pending.delete(abort));
    });
  }

  onEvent(listener: EventListener): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onGone(listener: () => void): () => void {
    if (this.isGone) {
      queueMicrotask(listener);
      return () => {};
    }
    this.goneListeners.add(listener);
    return () => this.goneListeners.delete(listener);
  }

  /** The view is going away (closed, destroyed or crashed): fail what waits and tell the relay. */
  markGone(): void {
    if (this.isGone) return;
    this.isGone = true;
    const closed = new Error("Target closed");
    for (const abort of this.pending) abort(closed);
    this.pending.clear();
    for (const l of [...this.goneListeners]) l();
    this.goneListeners.clear();
    this.events.clear();
  }

  detach(): void {
    try {
      if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) {
        this.contents.debugger.detach();
      }
    } catch {
      // Already gone.
    }
  }
}
