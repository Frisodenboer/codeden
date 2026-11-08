import {
  CODEDEN_VERSION,
  type DesktopUpdateCommand,
  type DesktopUpdateState,
  isNewerVersion,
  type ReleaseNotes,
  type UpdateMode,
  type UpdateState,
  type UpdateStatus,
} from "@codeden/contracts";
import { conflict, errorMessage } from "../errors";
import { fetchReleaseNotes, type NotesSources } from "./registry";

/**
 * The desktop app's updater (§17), as the server sees it: the state mirrored from the main
 * process and a way to run commands there. The desktop server host implements it over IPC.
 */
export interface DesktopUpdater {
  state(): DesktopUpdateState;
  onChange(listener: (state: DesktopUpdateState) => void): () => void;
  /** Resolves when the main process finished the command; rejects with its error. */
  run(command: DesktopUpdateCommand): Promise<void>;
}

export interface DesktopUpdateServiceDeps {
  desktop: DesktopUpdater;
  /** `settings.updates.mode`. */
  mode: () => UpdateMode;
  /** `CODEDEN_UPDATE_CHECK=0`: never check (tests, air-gapped machines). */
  checksDisabled?: boolean;
  notes?: NotesSources;
  fetch?: typeof fetch;
  current?: string;
  now?: () => number;
  /** Background check interval (default 6 hours). */
  intervalMs?: number;
  log?: (message: string) => void;
}

const SIX_HOURS = 6 * 3600_000;
export const DESKTOP_RELEASES_URL = "https://github.com/leonvanzyl/codeden/releases/latest";

/**
 * Update checks for the desktop app (§17). Same contract and policy as the npm self-update
 * (`UpdateService`): check on start and every 6 hours unless the mode is `off`, offer the
 * update in `notify` mode, download it in the background in `auto` mode (it installs when
 * the app quits). The work itself (GitHub Releases, download, installer) happens in the
 * desktop main process; this class drives it and maps its state onto `UpdateStatus`, so the
 * existing update banner and About page work unchanged.
 */
export class DesktopUpdateService {
  private timer: NodeJS.Timeout | undefined;
  private restartWhenDownloaded = false;
  /** The last command that failed was a download or install (an "update failed", not a check). */
  private installFailed = false;
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private readonly notesCache = new Map<string, Promise<ReleaseNotes>>();
  private readonly stopDesktopEvents: () => void;

  constructor(private readonly deps: DesktopUpdateServiceDeps) {
    this.stopDesktopEvents = deps.desktop.onChange((state) => this.onDesktopState(state));
  }

  private get current(): string {
    return this.deps.current ?? CODEDEN_VERSION;
  }

  private get enabled(): boolean {
    return this.deps.mode() !== "off" && !this.deps.checksDisabled;
  }

  start(): void {
    void this.checkAndMaybeDownload();
    this.timer = setInterval(
      () => void this.checkAndMaybeDownload(),
      this.deps.intervalMs ?? SIX_HOURS,
    );
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.stopDesktopEvents();
  }

  onChange(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async status(opts: { refresh?: boolean } = {}): Promise<UpdateStatus> {
    if (this.enabled) {
      const { checkedAt, phase } = this.deps.desktop.state();
      const last = checkedAt ? Date.parse(checkedAt) : null;
      const stale = last === null || this.now() - last > SIX_HOURS;
      if ((opts.refresh || stale) && isQuiet(phase)) await this.check();
    }
    return this.snapshot();
  }

  snapshot(): UpdateStatus {
    const d = this.deps.desktop.state();
    const enabled = this.enabled;
    const latestIsNewer = d.latest !== null && isNewerVersion(d.latest, this.current);
    let state: UpdateState = "idle";
    let progress: string | null = null;
    if (d.phase === "downloading") {
      state = "installing";
      progress = d.percent === null ? "Downloading" : `Downloading ${Math.floor(d.percent)}%`;
    } else if (d.phase === "downloaded") state = "installed";
    else if (d.phase === "installing") state = "restarting";
    else if (d.phase === "error" && this.installFailed) state = "failed";
    const checkError = d.phase === "error" && !this.installFailed ? d.error : null;
    return {
      current: this.current,
      latest: d.latest,
      updateAvailable: enabled && latestIsNewer && d.unsupported === null,
      enabled,
      mode: this.deps.mode(),
      checkedAt: d.checkedAt,
      error: enabled ? (d.unsupported ?? checkError) : null,
      command: DESKTOP_RELEASES_URL,
      source: "desktop",
      state,
      target: state === "idle" ? null : d.latest,
      progress,
      installError: state === "failed" ? (d.error ?? "The update could not be downloaded") : null,
      canRestart: d.unsupported === null,
      restartCommand: "Quit CodeDen from the tray and open it again",
      installed: [],
      rollbackTo: null,
      canRollback: false,
      warning: null,
    };
  }

  /**
   * Download the latest release and, unless `restart` is false, install it and restart the
   * app once downloaded. Returns at once; progress follows through `onChange`.
   */
  install(opts: { version?: string; restart?: boolean } = {}): UpdateStatus {
    const d = this.deps.desktop.state();
    if (d.unsupported) throw conflict(d.unsupported, "updates_unsupported");
    if (opts.version && d.latest && opts.version !== d.latest) {
      throw conflict(
        `The desktop app installs the latest release (${d.latest}); download older versions from GitHub.`,
        "version_unavailable",
      );
    }
    if (d.phase === "downloading" || d.phase === "installing") return this.snapshot();
    const restart = opts.restart !== false;
    if (d.phase === "downloaded") {
      if (restart) this.runCommand("install");
      return this.snapshot();
    }
    this.restartWhenDownloaded = restart;
    this.runCommand("download");
    return this.snapshot();
  }

  /** Install the downloaded update and restart the app. */
  restartNow(): UpdateStatus {
    if (this.deps.desktop.state().phase !== "downloaded") {
      throw conflict("No downloaded update is waiting for a restart", "nothing_to_restart");
    }
    this.runCommand("install");
    return this.snapshot();
  }

  rollback(): UpdateStatus {
    throw conflict(
      "The desktop app can't roll back by itself; install an older release from GitHub.",
      "nothing_to_roll_back",
    );
  }

  notes(version: string): Promise<ReleaseNotes> {
    let cached = this.notesCache.get(version);
    if (!cached) {
      cached = fetchReleaseNotes(version, this.deps.notes, this.deps.fetch);
      cached.catch(() => this.notesCache.delete(version));
      this.notesCache.set(version, cached);
    }
    return cached;
  }

  private async checkAndMaybeDownload(): Promise<void> {
    if (!this.enabled || !isQuiet(this.deps.desktop.state().phase)) return;
    await this.check();
    const d = this.deps.desktop.state();
    if (this.deps.mode() === "auto" && d.phase === "available" && d.unsupported === null) {
      this.deps.log?.(`updates: downloading ${d.latest} in the background (auto mode)`);
      this.restartWhenDownloaded = false;
      this.runCommand("download");
    }
  }

  private async check(): Promise<void> {
    try {
      await this.deps.desktop.run("check");
      this.installFailed = false;
    } catch (error) {
      this.deps.log?.(`updates: check failed: ${errorMessage(error)}`);
    }
    this.emit();
  }

  private runCommand(command: DesktopUpdateCommand): void {
    this.installFailed = false;
    void this.deps.desktop.run(command).catch((error: unknown) => {
      this.installFailed = true;
      this.restartWhenDownloaded = false;
      this.deps.log?.(`updates: ${command} failed: ${errorMessage(error)}`);
      this.emit();
    });
  }

  private onDesktopState(state: DesktopUpdateState): void {
    if (state.phase === "downloaded" && this.restartWhenDownloaded) {
      this.restartWhenDownloaded = false;
      this.runCommand("install");
    }
    this.emit();
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const status = this.snapshot();
    for (const listener of this.listeners) listener(status);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

/** No check, download or install is in flight. */
function isQuiet(phase: DesktopUpdateState["phase"]): boolean {
  return phase === "idle" || phase === "available" || phase === "error";
}
