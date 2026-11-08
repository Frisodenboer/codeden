import {
  type DesktopUpdateCommand,
  type DesktopUpdateState,
  isNewerVersion,
} from "@codeden/contracts";

/** The part of electron-updater's `autoUpdater` the controller uses (injectable for tests). */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "download-progress", listener: (info: { percent: number }) => void): unknown;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateControllerOptions {
  current: string;
  /** Why updates can't work in this build (see `updateSupport`), or null. */
  unsupported: string | null;
  /** Created on first use, so development runs never load the updater. */
  updater: () => Updater | Promise<Updater>;
  /**
   * Run before the installer takes over: stop the server and drain the runner, which may run
   * from the install folder (Windows locks files in use).
   */
  beforeInstall: () => Promise<void>;
  now?: () => number;
  /** Waits between check retries (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

/** Waits before retrying a check that hit a transient network or GitHub error. */
const CHECK_RETRY_DELAYS_MS = [2_000, 6_000];

/**
 * The latest release has no update file for this platform yet: a release is still being
 * published (its installers are attached after it is created). Nothing to install yet.
 */
export function isMissingUpdateFile(message: string): boolean {
  return /cannot find latest(-[a-z]+)?\.yml/i.test(message) || /\b404\b/.test(message);
}

/** A failure worth retrying: GitHub 5xx or 429, a timeout, or a dropped connection. */
export function isTransientUpdateError(message: string): boolean {
  return /\b(5\d\d|429)\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|net::ERR_|socket hang up|timed? ?out/i.test(
    message,
  );
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

/**
 * The desktop updater (§17): electron-updater against GitHub Releases, driven by explicit
 * commands (check, download, install) from the server's update policy or the tray. Downloads
 * never start by themselves and never install on quit behind our back: quitting with a
 * downloaded update goes through `install` so the runner is stopped first.
 */
export class UpdateController {
  private current: DesktopUpdateState;
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>();
  private instance: Updater | undefined;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly opts: UpdateControllerOptions) {
    this.current = {
      phase: "idle",
      current: opts.current,
      latest: null,
      checkedAt: null,
      percent: null,
      error: null,
      unsupported: opts.unsupported,
    };
  }

  get state(): DesktopUpdateState {
    return this.current;
  }

  onChange(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Run a command; rejects with the reason it failed (also recorded in the state). */
  run(command: DesktopUpdateCommand): Promise<void> {
    if (this.current.unsupported) return Promise.reject(new Error(this.current.unsupported));
    if (command === "install") return this.install();
    // One check or download at a time; a second request joins the first.
    this.inFlight ??= (command === "check" ? this.check() : this.download()).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async updater(): Promise<Updater> {
    if (!this.instance) {
      const u = await this.opts.updater();
      u.autoDownload = false;
      u.autoInstallOnAppQuit = false;
      u.on("download-progress", (info) => {
        if (this.current.phase === "downloading") this.set({ percent: clampPercent(info.percent) });
      });
      this.instance = u;
    }
    return this.instance;
  }

  private async check(): Promise<void> {
    // A download in progress or done already answers the question.
    const busy = ["downloading", "downloaded", "installing"];
    if (busy.includes(this.current.phase)) return;
    this.set({ phase: "checking", error: null });
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await (await this.updater()).checkForUpdates();
        const latest = result?.updateInfo.version ?? this.opts.current;
        const newer = isNewerVersion(latest, this.opts.current);
        this.set({ phase: newer ? "available" : "idle", latest, checkedAt: this.nowIso() });
        return;
      } catch (error) {
        const message = firstLine(error);
        if (isMissingUpdateFile(message)) {
          // A release still being published: not an error, there's just nothing to install yet.
          this.opts.log?.(`updates: the latest release has no update file yet (${message})`);
          this.set({ phase: "idle", latest: this.opts.current, checkedAt: this.nowIso() });
          return;
        }
        const delay = CHECK_RETRY_DELAYS_MS[attempt];
        if (isTransientUpdateError(message) && delay !== undefined) {
          this.opts.log?.(`updates: check failed (${message}); retrying in ${delay / 1000}s`);
          await sleep(delay);
          continue;
        }
        const friendly = isTransientUpdateError(message)
          ? "Couldn't reach GitHub to check for updates. Try again in a minute."
          : message;
        this.fail(new Error(friendly), { checkedAt: this.nowIso() });
      }
    }
  }

  private async download(): Promise<void> {
    if (this.current.phase === "downloaded") return;
    // Download only what a check just found (electron-updater needs the check first).
    if (this.current.phase !== "available") await this.check();
    if (this.current.phase !== "available") return;
    this.set({ phase: "downloading", percent: 0, error: null });
    try {
      await (await this.updater()).downloadUpdate();
      this.set({ phase: "downloaded", percent: 100 });
      this.opts.log?.(`updates: downloaded ${this.current.latest}`);
    } catch (error) {
      this.fail(error, { percent: null });
    }
  }

  private async install(): Promise<void> {
    if (this.current.phase !== "downloaded") throw new Error("No downloaded update to install");
    this.set({ phase: "installing" });
    try {
      await this.opts.beforeInstall();
    } catch (error) {
      this.opts.log?.(`updates: preparing the install failed: ${String(error)}`);
    }
    this.opts.log?.(`updates: installing ${this.current.latest} and restarting`);
    // Silent install, then start the new version (sessions resume through the usual path).
    (await this.updater()).quitAndInstall(true, true);
  }

  /** Quitting with a downloaded update: install without starting the app again. */
  async installOnQuit(): Promise<void> {
    if (this.current.phase !== "downloaded") return;
    this.set({ phase: "installing" });
    await this.opts.beforeInstall().catch(() => undefined);
    (await this.updater()).quitAndInstall(true, false);
  }

  private fail(error: unknown, patch: Partial<DesktopUpdateState>): never {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    this.opts.log?.(`updates: ${message}`);
    this.set({ ...patch, phase: "error", error: message ?? "Update failed" });
    throw new Error(message);
  }

  private set(patch: Partial<DesktopUpdateState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.current);
  }

  private nowIso(): string {
    return new Date(this.opts.now?.() ?? Date.now()).toISOString();
  }
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
