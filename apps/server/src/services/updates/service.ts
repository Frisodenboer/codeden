import {
  CODEDEN_VERSION,
  compareVersions,
  type InstallSource,
  isNewerVersion,
  type ReleaseNotes,
  type UpdateMode,
  type UpdateState,
  type UpdateStatus,
} from "@codeden/contracts";
import { conflict, errorMessage } from "../errors";
import {
  applyRollback,
  installProblem,
  isVersionName,
  listInstalled,
  packageRoot,
  pruneInstalled,
  readPointer,
  rollbackTarget,
  writePointer,
} from "./app-dir";
import { type InstallAppOptions, installAppVersion } from "./installer";
import { takeUpdateResult } from "./last-result";
import { fetchLatestVersion, fetchReleaseNotes, type NotesSources } from "./registry";

/** How the process hosting the server was started, and whether it can hand over (§16). */
export interface SelfUpdateHost {
  source: InstallSource;
  /**
   * Stop this server and start `version` in its place (`null`: the copy the user launched).
   * Absent when the server can't restart itself; the UI then asks for a manual restart.
   */
  restart?: (target: { version: string | null }) => void;
  /** What to run to restart by hand, e.g. `npx codeden`. */
  restartCommand: string;
  /** Version of the `codeden` copy the user ran (rollback floor). */
  launcherVersion: string;
  /** The launcher could not start the pinned version (shown in the UI). */
  warning?: string | null;
}

export interface UpdateServiceDeps {
  home: string;
  /** `settings.updates.mode`. */
  mode: () => UpdateMode;
  /** `CODEDEN_UPDATE_CHECK=0`: never ask the registry (tests, air-gapped machines). */
  checksDisabled?: boolean;
  host?: SelfUpdateHost;
  registry: string;
  fetch?: typeof fetch;
  install?: (opts: InstallAppOptions) => Promise<void>;
  notes?: NotesSources;
  current?: string;
  now?: () => number;
  /** Background check interval (default 6 hours). */
  intervalMs?: number;
  log?: (message: string) => void;
}

const SIX_HOURS = 6 * 3600_000;
const DEV_HOST: SelfUpdateHost = {
  source: "source",
  restartCommand: "pnpm dev",
  launcherVersion: CODEDEN_VERSION,
};

/**
 * Update checks and one-click self-update (§16). Asks the npm registry for `codeden`'s
 * `latest` dist-tag on start and every 6 hours (unless the mode is `off`); installs a version
 * side by side into `<home>/app/<version>`, points `current.json` at it and hands over to it
 * through the host's `restart`. In `auto` mode a new version is installed in the background
 * and starts on the next launch. Every change is pushed to `onChange` listeners (the UI).
 */
export class UpdateService {
  private latest: string | null = null;
  private checkedAt: number | null = null;
  private error: string | null = null;
  private inFlight: Promise<void> | null = null;
  private state: UpdateState = "idle";
  private target: string | null = null;
  private progress: string | null = null;
  private installError: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private readonly notesCache = new Map<string, Promise<ReleaseNotes>>();
  private readonly host: SelfUpdateHost;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.host = deps.host ?? DEV_HOST;
    const last = takeUpdateResult(deps.home);
    if (last && !last.ok) {
      this.state = "failed";
      this.target = last.to;
      this.installError = last.error ?? `CodeDen ${last.to} did not start`;
    }
  }

  private get current(): string {
    return this.deps.current ?? CODEDEN_VERSION;
  }

  private get enabled(): boolean {
    return this.deps.mode() !== "off" && !this.deps.checksDisabled;
  }

  /** Check now, then every 6 hours; `auto` mode installs what it finds for the next launch. */
  start(): void {
    void this.checkAndMaybeInstall();
    this.timer = setInterval(
      () => void this.checkAndMaybeInstall(),
      this.deps.intervalMs ?? SIX_HOURS,
    );
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  onChange(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async status(opts: { refresh?: boolean } = {}): Promise<UpdateStatus> {
    if (this.enabled) {
      const stale = this.checkedAt === null || this.now() - this.checkedAt > SIX_HOURS;
      if (opts.refresh || stale) await this.check();
    }
    return this.snapshot();
  }

  /** The current status without contacting the registry. */
  snapshot(): UpdateStatus {
    const enabled = this.enabled;
    const current = this.current;
    const pointer = readPointer(this.deps.home);
    let state = this.state;
    let target = this.target;
    // Installed by `codeden update`, auto mode or an earlier session: ready for a restart.
    if (state === "idle" && pointer && isNewerVersion(pointer.version, current)) {
      if (!installProblem(packageRoot(this.deps.home, pointer.version), pointer.version)) {
        state = "installed";
        target = pointer.version;
      }
    }
    const rollbackTo = pointer
      ? (rollbackTarget(this.deps.home, this.host.launcherVersion) ?? this.host.launcherVersion)
      : null;
    return {
      current,
      latest: this.latest,
      updateAvailable: enabled && this.latest !== null && isNewerVersion(this.latest, current),
      enabled,
      mode: this.deps.mode(),
      checkedAt: this.checkedAt === null ? null : new Date(this.checkedAt).toISOString(),
      error: enabled ? this.error : null,
      command: "npm i -g codeden@latest",
      source: this.host.source,
      state,
      target,
      progress: state === "installing" ? this.progress : null,
      installError: state === "failed" ? this.installError : null,
      canRestart: this.host.source === "packaged" && this.host.restart !== undefined,
      restartCommand: this.host.restartCommand,
      installed: listInstalled(this.deps.home),
      rollbackTo,
      canRollback: this.host.source === "packaged" && pointer !== null,
      warning: this.host.warning ?? null,
    };
  }

  /**
   * Install `version` (default: the latest) and, unless `restart` is false, hand over to it.
   * Returns at once with the `installing` status; progress follows through `onChange`.
   */
  install(opts: { version?: string; restart?: boolean } = {}): UpdateStatus {
    if (this.host.source === "source") {
      throw conflict(
        "You're running CodeDen from source: pull and rebuild to update.",
        "running_from_source",
      );
    }
    if (this.state === "installing" || this.state === "restarting") return this.snapshot();
    const restart = opts.restart !== false;
    this.state = "installing";
    this.target = opts.version ?? this.latest;
    this.progress = "Starting";
    this.installError = null;
    this.emit();
    void this.runInstall(opts.version, restart);
    return this.snapshot();
  }

  /** Hand over to the installed version waiting for a restart. */
  restartNow(): UpdateStatus {
    const snap = this.snapshot();
    if (snap.state !== "installed" || !snap.target) {
      throw conflict("No installed update is waiting for a restart", "nothing_to_restart");
    }
    this.handOver(snap.target);
    return this.snapshot();
  }

  /** Point the launcher back at the previous version and restart into it. */
  rollback(): UpdateStatus {
    if (this.host.source === "source" || !readPointer(this.deps.home)) {
      throw conflict("There is no previous version to roll back to", "nothing_to_roll_back");
    }
    const result = applyRollback(this.deps.home, this.host.launcherVersion);
    if (!result) throw conflict("There is no previous version to roll back to");
    this.deps.log?.(`updates: rolled back; ${result.next} starts next`);
    this.installError = null;
    this.handOver(result.pinned ? result.next : null, result.next);
    return this.snapshot();
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

  private async checkAndMaybeInstall(): Promise<void> {
    if (!this.enabled) return;
    await this.check();
    const latest = this.latest;
    if (
      this.deps.mode() === "auto" &&
      this.host.source === "packaged" &&
      latest &&
      isNewerVersion(latest, this.current) &&
      this.snapshot().state === "idle"
    ) {
      this.deps.log?.(`updates: installing ${latest} in the background (auto mode)`);
      this.install({ version: latest, restart: false });
    }
  }

  private check(): Promise<void> {
    this.inFlight ??= this.fetchLatest().finally(() => {
      this.inFlight = null;
      this.emit();
    });
    return this.inFlight;
  }

  private async fetchLatest(): Promise<void> {
    try {
      this.latest = await fetchLatestVersion(this.deps.registry, this.deps.fetch);
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
      this.deps.log?.(`updates: ${this.error}`);
    } finally {
      this.checkedAt = this.now();
    }
  }

  private async runInstall(requested: string | undefined, restart: boolean): Promise<void> {
    try {
      let version = requested;
      if (!version) {
        await this.check();
        version = this.latest ?? undefined;
        if (!version) throw new Error(this.error ?? "the latest version is unknown");
      }
      if (!isVersionName(version)) throw new Error(`"${version}" is not a version`);
      if (compareVersions(version, this.current) === 0) throw new Error(`${version} is running`);
      this.target = version;
      this.emit();
      const install = this.deps.install ?? installAppVersion;
      await install({
        home: this.deps.home,
        version,
        registry: this.deps.registry,
        onProgress: (line) => {
          this.progress = line;
          this.emit();
        },
      });
      writePointer(this.deps.home, version, this.current);
      pruneInstalled(this.deps.home, [this.current]);
      this.deps.log?.(`updates: installed ${version}`);
      this.state = "idle"; // `snapshot()` now reports it as installed via current.json
      this.progress = null;
      if (restart) this.handOver(version);
      else this.emit();
    } catch (error) {
      this.state = "failed";
      this.installError = errorMessage(error);
      this.progress = null;
      this.deps.log?.(`updates: install failed: ${this.installError}`);
      this.emit();
    }
  }

  /** Restart into `version` (`null`: the launched copy), or leave it for the next launch. */
  private handOver(version: string | null, label = version ?? this.host.launcherVersion): void {
    const restart = this.host.restart;
    if (!restart || this.host.source !== "packaged") {
      this.state = "idle";
      this.emit();
      return;
    }
    this.state = "restarting";
    this.target = label;
    this.emit();
    // Let the UI receive "restarting" before the connection drops.
    setTimeout(() => restart({ version }), 300);
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
