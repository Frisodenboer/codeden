import { describe, expect, it } from "vitest";
import { CdpRelay, type Json, type RelayHost, type RelayTarget } from "../src/main/browser/relay";

type Listener = (method: string, params: Json, child?: string) => void;

/** A view whose CDP answers are scripted (or never come). */
class FakeTarget implements RelayTarget {
  gone = false;
  readonly sent: { method: string; params: Json | undefined; child?: string }[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly goneListeners = new Set<() => void>();
  /** Methods that never answer (a capture of a removed view). */
  hang = new Set<string>();

  constructor(
    readonly targetId: string,
    private readonly address = "http://localhost:5173/",
    readonly openerId?: string,
  ) {}

  url() {
    return this.address;
  }
  title() {
    return `Title ${this.targetId}`;
  }
  send(method: string, params: Json | undefined, child?: string): Promise<unknown> {
    this.sent.push({ method, params, child });
    if (this.hang.has(method)) return new Promise(() => {});
    if (method === "Fail.me") return Promise.reject(new Error("Boom"));
    return Promise.resolve({ echoed: method, child: child ?? null });
  }
  onEvent(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onGone(l: () => void) {
    this.goneListeners.add(l);
    return () => this.goneListeners.delete(l);
  }
  emit(method: string, params: Json, child?: string) {
    for (const l of this.listeners) l(method, params, child);
  }
  close() {
    this.gone = true;
    for (const l of this.goneListeners) l();
  }
}

class FakeHost implements RelayHost {
  readonly list: FakeTarget[] = [];
  readonly activated: string[] = [];
  private readonly added = new Set<(t: RelayTarget) => void>();
  private next = 1;
  targets() {
    return this.list;
  }
  async createTarget(url: string) {
    const t = new FakeTarget(`T${this.next++}`, url);
    this.list.push(t);
    for (const l of this.added) l(t);
    return t;
  }
  async closeTarget(target: RelayTarget) {
    const i = this.list.indexOf(target as FakeTarget);
    if (i >= 0) this.list.splice(i, 1);
    (target as FakeTarget).close();
  }
  activateTarget(target: RelayTarget) {
    this.activated.push(target.targetId);
  }
  onTargetAdded(l: (t: RelayTarget) => void) {
    this.added.add(l);
    return () => this.added.delete(l);
  }
}

interface Message {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  sessionId?: string;
}

/** A CDP client of the relay: sends commands, collects everything it receives. */
function client(relay: CdpRelay) {
  const inbox: Message[] = [];
  let closed = false;
  const conn = relay.connect({
    send: (data) => inbox.push(JSON.parse(data)),
    close: () => {
      closed = true;
    },
  });
  let id = 0;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    inbox,
    get closed() {
      return closed;
    },
    close: () => conn.close(),
    async send(method: string, params: Json = {}, sessionId?: string): Promise<Message> {
      const msgId = ++id;
      conn.receive(JSON.stringify({ id: msgId, method, params, sessionId }));
      for (let i = 0; i < 50; i++) {
        const reply = inbox.find((m) => m.id === msgId);
        if (reply) return reply;
        await tick();
      }
      return { id: msgId, error: { code: 0, message: "no reply" } };
    },
    events: (method: string) => inbox.filter((m) => m.method === method),
  };
}

const opts = { product: "Chrome/156.0", userAgent: "Mozilla/5.0 Chrome/156.0" };

describe("CDP relay: a browser endpoint that knows one session's views", () => {
  it("answers the browser-level calls connectOverCDP makes and announces existing tabs", async () => {
    const host = new FakeHost();
    await host.createTarget("http://localhost:3000/");
    const relay = new CdpRelay(host, opts);
    const c = client(relay);
    expect((await c.send("Browser.getVersion")).result).toMatchObject({ product: "Chrome/156.0" });
    expect((await c.send("Browser.setDownloadBehavior", { behavior: "allow" })).result).toEqual({});
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    const [attached] = c.events("Target.attachedToTarget");
    expect(attached?.params).toMatchObject({
      waitingForDebugger: false,
      targetInfo: { targetId: "T1", type: "page", url: "http://localhost:3000/" },
    });
    expect((attached?.params?.targetInfo as Json | undefined)?.browserContextId).toBeTruthy();
    expect((await c.send("Target.getTargetInfo")).result).toMatchObject({
      targetInfo: { type: "browser" },
    });
  });

  it("forwards page sessions to their view and fans the view's events out", async () => {
    const host = new FakeHost();
    const relay = new CdpRelay(host, opts);
    const c = client(relay);
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    const created = await c.send("Target.createTarget", { url: "about:blank" });
    // The attach is announced before the answer, as a real browser does.
    const attachIndex = c.inbox.findIndex((m) => m.method === "Target.attachedToTarget");
    expect(attachIndex).toBeGreaterThanOrEqual(0);
    expect(attachIndex).toBeLessThan(c.inbox.indexOf(created));
    const page = c.events("Target.attachedToTarget")[0]?.params?.sessionId as string;
    const target = host.list[0] as FakeTarget;

    expect((await c.send("Runtime.evaluate", { expression: "1" }, page)).result).toEqual({
      echoed: "Runtime.evaluate",
      child: null,
    });
    // A second session on the same view (newCDPSession): no announcement, same events.
    const browserSession = (await c.send("Target.attachToBrowserTarget")).result
      ?.sessionId as string;
    const extra = (await c.send("Target.attachToTarget", { targetId: "T1" }, browserSession)).result
      ?.sessionId as string;
    expect(c.events("Target.attachedToTarget")).toHaveLength(1);
    target.emit("Page.loadEventFired", { timestamp: 1 });
    const loads = c.events("Page.loadEventFired").map((m) => m.sessionId);
    expect(loads.sort()).toEqual([page, extra].sort());

    // Child sessions (frames, workers) are routed by their own ids.
    target.emit("Target.attachedToTarget", { sessionId: "CHILD", targetInfo: {} });
    target.emit("Runtime.consoleAPICalled", { type: "log" }, "CHILD");
    expect(c.events("Runtime.consoleAPICalled")[0]?.sessionId).toBe("CHILD");
    expect((await c.send("Runtime.enable", {}, "CHILD")).result).toEqual({
      echoed: "Runtime.enable",
      child: "CHILD",
    });
  });

  it("sees only its own session: other targets, contexts and system calls are refused", async () => {
    const mine = new FakeHost();
    const theirs = new FakeHost();
    await mine.createTarget("http://localhost:5173/");
    const other = await theirs.createTarget("http://localhost:5173/secret");
    const c = client(new CdpRelay(mine, opts));
    expect((await c.send("Target.getTargets")).result?.targetInfos).toEqual([
      expect.objectContaining({ targetId: "T1" }),
    ]);
    for (const method of ["Target.attachToTarget", "Target.closeTarget", "Target.activateTarget"]) {
      const reply = await c.send(method, { targetId: other.targetId === "T1" ? "nope" : "T9" });
      expect(reply.error?.message).toMatch(/No target/);
    }
    expect((await c.send("Target.createBrowserContext")).error?.code).toBe(-32601);
    expect((await c.send("SystemInfo.getProcessInfo")).error?.code).toBe(-32601);
    expect((await c.send("Page.navigate", { url: "x" }, "made-up-session")).error?.message).toMatch(
      /No session/,
    );
  });

  it("refuses browser-internal pages and local files, and keeps the user's colour scheme", async () => {
    const host = new FakeHost();
    const c = client(new CdpRelay(host, opts));
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    for (const url of ["chrome://settings", "file:///etc/passwd", "devtools://devtools/x"]) {
      expect((await c.send("Target.createTarget", { url })).error?.message).toMatch(/not allowed/);
    }
    await c.send("Target.createTarget", { url: "about:blank" });
    const page = c.events("Target.attachedToTarget")[0]?.params?.sessionId as string;
    const target = host.list[0] as FakeTarget;
    for (const url of ["file:///C:/Windows/win.ini", "edge://flags", "javascript:alert(1)"]) {
      expect((await c.send("Page.navigate", { url }, page)).error?.message).toMatch(/not allowed/);
    }
    expect((await c.send("Page.navigate", { url: "http://localhost:3000/" }, page)).result).toEqual(
      { echoed: "Page.navigate", child: null },
    );
    expect((await c.send("Emulation.setEmulatedMedia", { media: "" }, page)).result).toEqual({});
    expect(target.sent.map((s) => s.method)).toEqual(["Page.navigate"]);
  });

  it("brings tabs to the front and closes them through the app", async () => {
    const host = new FakeHost();
    const c = client(new CdpRelay(host, opts));
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    await c.send("Target.createTarget", { url: "about:blank" });
    await c.send("Target.createTarget", { url: "about:blank" });
    const [first, second] = c.events("Target.attachedToTarget").map((m) => m.params?.sessionId);
    await c.send("Page.bringToFront", {}, first as string);
    await c.send("Target.activateTarget", { targetId: "T2" });
    expect(host.activated).toEqual(["T1", "T2"]);
    await c.send("Page.close", {}, second as string);
    expect(host.list.map((t) => t.targetId)).toEqual(["T1"]);
    expect((await c.send("Target.closeTarget", { targetId: "T1" })).result).toEqual({
      success: true,
    });
    expect(host.list).toEqual([]);
    expect(c.events("Target.detachedFromTarget").map((m) => m.params?.targetId)).toEqual([
      "T2",
      "T1",
    ]);
  });

  it("fails commands still waiting on a view the moment it goes away", async () => {
    const host = new FakeHost();
    const c = client(new CdpRelay(host, opts));
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    await c.send("Target.createTarget", { url: "about:blank" });
    const page = c.events("Target.attachedToTarget")[0]?.params?.sessionId as string;
    const target = host.list[0] as FakeTarget;
    target.hang.add("Page.captureScreenshot");
    const shot = c.send("Page.captureScreenshot", { format: "png" }, page);
    await new Promise((r) => setTimeout(r, 5));
    target.close();
    const reply = await shot;
    expect(reply.error?.message).toBe("Target closed");
    expect(c.events("Target.detachedFromTarget")[0]?.params).toMatchObject({
      sessionId: page,
      targetId: "T1",
    });
    // The view is gone: later commands on its session fail fast too.
    expect((await c.send("Runtime.evaluate", {}, page)).error?.message).toMatch(/No session/);
  });

  it("times captures out instead of waiting forever", async () => {
    const host = new FakeHost();
    const c = client(new CdpRelay(host, { ...opts, captureTimeoutMs: 20 }));
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    await c.send("Target.createTarget", { url: "about:blank" });
    const page = c.events("Target.attachedToTarget")[0]?.params?.sessionId as string;
    (host.list[0] as FakeTarget).hang.add("Page.captureScreenshot");
    const reply = await new Promise<Message>((resolve) => {
      void c.send("Page.captureScreenshot", {}, page);
      setTimeout(() => resolve(c.inbox.find((m) => m.error) ?? {}), 80);
    });
    expect(reply.error?.message).toMatch(/timed out/);
  });

  it("tracks its clients and announces new tabs only to auto-attached ones", async () => {
    const host = new FakeHost();
    const counts: number[] = [];
    const relay = new CdpRelay(host, { ...opts, onConnections: (n) => counts.push(n) });
    const a = client(relay);
    const b = client(relay);
    await a.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    await host.createTarget("http://localhost:1234/");
    expect(a.events("Target.attachedToTarget")).toHaveLength(1);
    expect(b.events("Target.attachedToTarget")).toHaveLength(0);
    expect(relay.connectionCount).toBe(2);
    b.close();
    relay.disconnectAll();
    expect(a.closed).toBe(true);
    expect(counts).toEqual([1, 2, 1]);
  });

  it("passes CDP errors through", async () => {
    const host = new FakeHost();
    const c = client(new CdpRelay(host, opts));
    await c.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
    await c.send("Target.createTarget", { url: "about:blank" });
    const page = c.events("Target.attachedToTarget")[0]?.params?.sessionId as string;
    expect((await c.send("Fail.me", {}, page)).error).toEqual({ code: -32000, message: "Boom" });
  });
});
