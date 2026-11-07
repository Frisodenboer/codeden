import type { BrowserTab, RunnerStream } from "@codeden/contracts";
import { CommandError } from "../errors";
import { isAlive, killTree } from "../process/tree";
import { DEFAULT_EVALUATE_GUARD, type EvaluateGuard } from "./agent";
import type { ViewportSize } from "./input";
import { type LaunchedBrowser, type LaunchOptions, launchChromium } from "./launcher";
import { BrowserSession } from "./session";
import { devServerUrl } from "./urls";

export interface BrowserManagerOptions extends LaunchOptions {
  /** Ephemeral runner -> server stream (frames, tab updates). */
  stream: (data: RunnerStream) => void;
  /** Viewport of new tabs. Default 1280x800. */
  viewport?: ViewportSize;
  /** Default timeout for navigation and agent actions. Default 30s. */
  timeoutMs?: number;
  evaluate?: Partial<EvaluateGuard>;
  /** Replace the launcher (tests). */
  launch?: (opts: LaunchOptions) => Promise<LaunchedBrowser>;
}

/**
 * The runner's browser (§12.2): one Chromium launched lazily on first use, one isolated
 * `BrowserContext` per CodeDen session. Agents and the panel drive the same tabs; the CDP
 * endpoint stays on 127.0.0.1.
 */
export class BrowserManager {
  private launched: LaunchedBrowser | undefined;
  private launching: Promise<LaunchedBrowser> | undefined;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly opening = new Map<string, Promise<BrowserSession>>();
  private shuttingDown = false;
  readonly evaluateGuard: EvaluateGuard;

  constructor(private readonly opts: BrowserManagerOptions) {
    this.evaluateGuard = { ...DEFAULT_EVALUATE_GUARD, ...opts.evaluate };
  }

  /** CDP endpoint of the running browser, or null before the first launch. */
  get cdpUrl(): string | null {
    return this.launched?.cdpUrl ?? null;
  }

  /** Browser process id, or null when not running. */
  get pid(): number | null {
    return this.launched?.pid ?? null;
  }

  /** Channel that was launched (`msedge`, `chrome`, ...), or null. */
  get channel(): string | null {
    return this.launched?.channel ?? null;
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Launch the browser if it is not running yet. */
  async ensureBrowser(): Promise<LaunchedBrowser> {
    if (this.shuttingDown) throw new CommandError("unavailable", "The browser is shutting down");
    if (this.launched?.browser.isConnected()) return this.launched;
    this.launching ??= (this.opts.launch ?? launchChromium)(this.opts)
      .then((launched) => {
        this.launched = launched;
        launched.browser.on("disconnected", () => this.onDisconnected(launched));
        return launched;
      })
      .finally(() => {
        this.launching = undefined;
      });
    return this.launching;
  }

  /** Open (or reuse) a session's context; opens a first tab, at `url` if given. */
  async open(sessionId: string, url?: string): Promise<BrowserSession> {
    const session = await this.ensureSession(sessionId);
    if (session.listTabs().length === 0) await session.openTab(url);
    else if (url) await session.navigate(url);
    return session;
  }

  /** The session's browser state; throws `not_found` if `browser.open` was not called. */
  get(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.isClosed) {
      throw new CommandError("not_found", `No browser for session ${sessionId}; open it first`);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isClosed === false;
  }

  /** Open a local dev server in a new tab of the session. */
  async openDevServer(sessionId: string, port: number, path = "/"): Promise<BrowserTab> {
    const session = await this.ensureSession(sessionId);
    return session.openTab(devServerUrl(port, path));
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    await session?.close();
  }

  /** Close every context and the browser, then kill whatever is left of its process tree. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.launching?.catch(() => undefined);
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
    this.sessions.clear();
    const launched = this.launched;
    this.launched = undefined;
    if (!launched) return;
    await Promise.race([
      launched.browser.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (launched.pid !== null && isAlive(launched.pid)) await killTree(launched.pid);
  }

  private async ensureSession(sessionId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing && !existing.isClosed) return existing;
    let pending = this.opening.get(sessionId);
    if (!pending) {
      pending = (async () => {
        const { browser } = await this.ensureBrowser();
        const viewport = this.opts.viewport ?? { width: 1280, height: 800 };
        const context = await browser.newContext({ viewport });
        const session = new BrowserSession({
          sessionId,
          context,
          viewport,
          stream: this.opts.stream,
          timeoutMs: this.opts.timeoutMs ?? 30_000,
        });
        this.sessions.set(sessionId, session);
        return session;
      })().finally(() => this.opening.delete(sessionId));
      this.opening.set(sessionId, pending);
    }
    return pending;
  }

  private onDisconnected(launched: LaunchedBrowser): void {
    if (this.launched !== launched) return;
    // Crashed or killed: drop state so the next command relaunches.
    this.opts.log?.("browser: disconnected");
    this.launched = undefined;
    for (const session of this.sessions.values()) void session.close();
    this.sessions.clear();
  }
}
