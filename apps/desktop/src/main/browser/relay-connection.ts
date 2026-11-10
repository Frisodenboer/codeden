import { randomBytes } from "node:crypto";
import type { Json, RelayHost, RelayOptions, RelaySocket, RelayTarget } from "./relay";
import { isAllowedBrowserUrl } from "./urls";

const CAPTURE_TIMEOUT_MS = 30_000;
const CAPTURE_METHODS = new Set(["Page.captureScreenshot", "Page.captureSnapshot"]);

/** A browser context id for the session's partition (CDP clients need one per page). */
const CONTEXT_ID = "codeden-session";

/**
 * Media and focus emulation the runner never asks for. Playwright sends `setEmulatedMedia` for
 * every page it attaches to (forcing a light colour scheme); a native view keeps the user's.
 */
const SWALLOWED = new Set(["Emulation.setEmulatedMedia"]);

class CdpError extends Error {
  constructor(
    message: string,
    readonly code = -32000,
  ) {
    super(message);
  }
}

interface PageSession {
  target: RelayTarget;
  /** The session the attach came through (undefined: the root). */
  parent: string | undefined;
}

interface Pending {
  id: number;
  sessionId: string;
  timer?: NodeJS.Timeout;
}

/**
 * One CDP client of a session's relay (see `CdpRelay`): its sessions, the views it is attached
 * to, and the commands still waiting on each view.
 */
export class RelayConnection {
  private autoAttach = false;
  private closed = false;
  private readonly pages = new Map<string, PageSession>();
  private readonly browserSessions = new Set<string>();
  /** Child sessions (frames, workers) of the views this connection is attached to. */
  private readonly children = new Map<string, RelayTarget>();
  private readonly watched = new Map<RelayTarget, () => void>();
  private readonly pending = new Map<RelayTarget, Set<Pending>>();

  constructor(
    readonly socket: RelaySocket,
    private readonly host: RelayHost,
    private readonly opts: RelayOptions,
  ) {}

  receive(data: string): void {
    let msg: { id?: unknown; method?: unknown; params?: unknown; sessionId?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const id = typeof msg.id === "number" ? msg.id : null;
    if (id === null || typeof msg.method !== "string") return;
    const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Json;
    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
    void this.dispatch(id, msg.method, params, sessionId);
  }

  targetAdded(target: RelayTarget): void {
    if (this.autoAttach && !target.gone) this.attachPage(target, undefined, true);
  }

  dispose(): void {
    this.closed = true;
    for (const stop of this.watched.values()) stop();
    this.watched.clear();
    for (const set of this.pending.values()) for (const p of set) clearTimeout(p.timer);
    this.pending.clear();
  }

  private async dispatch(id: number, method: string, params: Json, sessionId: string) {
    const page = this.pages.get(sessionId);
    try {
      if (!sessionId || this.browserSessions.has(sessionId)) {
        return this.reply(id, sessionId, await this.browserLevel(method, params, sessionId));
      }
      if (page) return await this.pageLevel(id, sessionId, page.target, method, params);
      const child = this.children.get(sessionId);
      if (child) return await this.forward(id, sessionId, child, method, params, sessionId);
      throw new CdpError(`No session with given id: ${sessionId}`);
    } catch (error) {
      this.fail(id, sessionId, error);
    }
  }

  private async browserLevel(method: string, params: Json, sessionId: string): Promise<Json> {
    const find = (targetId: unknown) => {
      const target = this.host.targets().find((t) => t.targetId === targetId && !t.gone);
      if (!target) throw new CdpError("No target with given id found");
      return target;
    };
    switch (method) {
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: this.opts.product,
          revision: "",
          userAgent: this.opts.userAgent,
          jsVersion: "",
        };
      case "Target.setAutoAttach":
        // Only the root's auto-attach means "every tab"; on a browser session it is a no-op.
        if (!sessionId) {
          this.autoAttach = params.autoAttach === true;
          if (this.autoAttach) {
            for (const t of this.host.targets()) {
              if (!t.gone && !this.attachedViaRoot(t)) this.attachPage(t, undefined, true);
            }
          }
        }
        return {};
      case "Target.getTargetInfo":
        if (params.targetId !== undefined) return { targetInfo: targetInfo(find(params.targetId)) };
        return {
          targetInfo: {
            targetId: "browser",
            type: "browser",
            title: "",
            url: "",
            attached: true,
            canAccessOpener: false,
          },
        };
      case "Target.getTargets":
        return {
          targetInfos: this.host
            .targets()
            .filter((t) => !t.gone)
            .map(targetInfo),
        };
      case "Target.getBrowserContexts":
        return { browserContextIds: [] };
      case "Target.setDiscoverTargets":
      case "Browser.setDownloadBehavior":
      case "Browser.close":
        // Downloads follow the app's own rules; a client "closing the browser" just leaves.
        return {};
      case "Browser.getWindowForTarget":
        return { windowId: 1, bounds: { windowState: "normal" } };
      case "Target.createTarget": {
        const url = typeof params.url === "string" ? params.url : "about:blank";
        if (!isAllowedBrowserUrl(url)) throw new CdpError(`Navigation to ${url} is not allowed`);
        const target = await this.host.createTarget(url);
        return { targetId: target.targetId };
      }
      case "Target.closeTarget":
        await this.host.closeTarget(find(params.targetId));
        return { success: true };
      case "Target.activateTarget":
        this.host.activateTarget(find(params.targetId));
        return {};
      case "Target.attachToBrowserTarget": {
        const id = newSessionId();
        this.browserSessions.add(id);
        return { sessionId: id };
      }
      case "Target.attachToTarget":
        return { sessionId: this.attachPage(find(params.targetId), sessionId || undefined, false) };
      case "Target.detachFromTarget": {
        const detached = typeof params.sessionId === "string" ? params.sessionId : "";
        const page = this.pages.get(detached);
        if (page) {
          this.pages.delete(detached);
          this.event("Target.detachedFromTarget", { sessionId: detached }, page.parent);
        }
        return {};
      }
      default:
        // Contexts, permissions, tracing, system info: nothing a session's tabs should reach.
        throw new CdpError(`'${method}' wasn't found`, -32601);
    }
  }

  private async pageLevel(
    id: number,
    sessionId: string,
    target: RelayTarget,
    method: string,
    params: Json,
  ): Promise<void> {
    switch (method) {
      case "Page.bringToFront":
        this.host.activateTarget(target);
        return this.reply(id, sessionId, {});
      case "Page.close":
        await this.host.closeTarget(target);
        return this.reply(id, sessionId, {});
      case "Page.navigate":
        if (typeof params.url !== "string" || !isAllowedBrowserUrl(params.url)) {
          throw new CdpError(`Navigation to ${String(params.url)} is not allowed`);
        }
        break;
      default:
        if (SWALLOWED.has(method)) return this.reply(id, sessionId, {});
    }
    return this.forward(id, sessionId, target, method, params, undefined);
  }

  /** Send a command to a view; fail it at once if the view goes away first. */
  private async forward(
    id: number,
    sessionId: string,
    target: RelayTarget,
    method: string,
    params: Json,
    childSessionId: string | undefined,
  ): Promise<void> {
    if (target.gone) throw new CdpError("Target closed");
    const entry: Pending = { id, sessionId };
    let set = this.pending.get(target);
    if (!set) {
      set = new Set();
      this.pending.set(target, set);
    }
    set.add(entry);
    if (CAPTURE_METHODS.has(method)) {
      const ms = this.opts.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
      entry.timer = setTimeout(() => {
        if (!set.delete(entry)) return;
        this.fail(id, sessionId, new CdpError(`${method} timed out after ${ms}ms`));
      }, ms);
      entry.timer.unref?.();
    }
    try {
      const result = await target.send(method, params, childSessionId);
      if (set.delete(entry)) this.reply(id, sessionId, (result ?? {}) as Json);
    } catch (error) {
      if (set.delete(entry)) this.fail(id, sessionId, error);
    } finally {
      clearTimeout(entry.timer);
    }
  }

  private attachedViaRoot(target: RelayTarget): boolean {
    for (const p of this.pages.values()) if (p.target === target && !p.parent) return true;
    return false;
  }

  /** A new session on a view; auto-attach announces it, `attachToTarget` just answers. */
  private attachPage(target: RelayTarget, parent: string | undefined, announce: boolean): string {
    const sessionId = newSessionId();
    this.pages.set(sessionId, { target, parent });
    this.watch(target);
    if (announce) {
      this.event(
        "Target.attachedToTarget",
        { sessionId, targetInfo: targetInfo(target), waitingForDebugger: false },
        parent,
      );
    }
    return sessionId;
  }

  private watch(target: RelayTarget): void {
    if (this.watched.has(target)) return;
    const stopEvents = target.onEvent((method, params, childSessionId) => {
      if (method === "Target.attachedToTarget" && typeof params.sessionId === "string") {
        this.children.set(params.sessionId, target);
      }
      if (childSessionId) {
        if (this.children.has(childSessionId)) this.event(method, params, childSessionId);
      } else {
        for (const [id, page] of this.pages)
          if (page.target === target) this.event(method, params, id);
      }
      if (method === "Target.detachedFromTarget" && typeof params.sessionId === "string") {
        this.children.delete(params.sessionId);
      }
    });
    const stopGone = target.onGone(() => this.targetGone(target));
    this.watched.set(target, () => {
      stopEvents();
      stopGone();
    });
  }

  /** A view closed: fail what waits on it and detach its sessions. */
  private targetGone(target: RelayTarget): void {
    for (const p of this.pending.get(target) ?? []) {
      clearTimeout(p.timer);
      this.fail(p.id, p.sessionId, new CdpError("Target closed"));
    }
    this.pending.delete(target);
    for (const [id, page] of [...this.pages]) {
      if (page.target !== target) continue;
      this.pages.delete(id);
      this.event(
        "Target.detachedFromTarget",
        { sessionId: id, targetId: target.targetId },
        page.parent,
      );
    }
    for (const [id, t] of [...this.children]) if (t === target) this.children.delete(id);
    this.watched.get(target)?.();
    this.watched.delete(target);
  }

  private reply(id: number, sessionId: string, result: Json): void {
    this.out({ id, ...(sessionId ? { sessionId } : {}), result });
  }

  private fail(id: number, sessionId: string, error: unknown): void {
    const code = error instanceof CdpError ? error.code : -32000;
    const message = error instanceof Error ? error.message : String(error);
    this.out({ id, ...(sessionId ? { sessionId } : {}), error: { code, message } });
  }

  private event(method: string, params: Json, sessionId: string | undefined): void {
    this.out({ method, params, ...(sessionId ? { sessionId } : {}) });
  }

  private out(message: Json): void {
    if (!this.closed) this.socket.send(JSON.stringify(message));
  }
}

function targetInfo(target: RelayTarget): Json {
  return {
    targetId: target.targetId,
    type: "page",
    title: target.gone ? "" : target.title(),
    url: target.gone ? "" : target.url(),
    attached: true,
    canAccessOpener: false,
    browserContextId: CONTEXT_ID,
    ...(target.openerId ? { openerId: target.openerId } : {}),
  };
}

function newSessionId(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}
