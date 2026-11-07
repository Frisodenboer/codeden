import { CODEDEN_VERSION, isNewerVersion, type UpdateStatus } from "@codeden/contracts";
import { errorMessage } from "./errors";

const REGISTRY_URL = "https://registry.npmjs.org/codeden/latest";
const CACHE_MS = 24 * 3600_000;
const TIMEOUT_MS = 5_000;

export interface UpdateServiceDeps {
  /** `settings.updates.check`. */
  enabled: () => boolean;
  fetch?: typeof fetch;
  /** Registry document of the latest release (default: npm's `codeden/latest`). */
  registryUrl?: string;
  current?: string;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * "Check for updates" (§16): asks the npm registry for the latest `codeden` version, at most
 * once a day unless asked to refresh, and only while the setting is on. Nothing else is sent.
 * The container also honours `CODEDEN_UPDATE_CHECK=0` (tests, air-gapped machines).
 */
export class UpdateService {
  private latest: string | null = null;
  private checkedAt: number | null = null;
  private error: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: UpdateServiceDeps) {}

  async status(opts: { refresh?: boolean } = {}): Promise<UpdateStatus> {
    const enabled = this.deps.enabled();
    if (enabled) {
      const stale = this.checkedAt === null || this.now() - this.checkedAt > CACHE_MS;
      if (opts.refresh || stale) await this.check();
    }
    const current = this.deps.current ?? CODEDEN_VERSION;
    return {
      current,
      latest: this.latest,
      updateAvailable: enabled && this.latest !== null && isNewerVersion(this.latest, current),
      enabled,
      checkedAt: this.checkedAt === null ? null : new Date(this.checkedAt).toISOString(),
      error: enabled ? this.error : null,
      command: "npm i -g codeden@latest",
    };
  }

  private check(): Promise<void> {
    this.inFlight ??= this.fetchLatest().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchLatest(): Promise<void> {
    const doFetch = this.deps.fetch ?? fetch;
    try {
      const res = await doFetch(this.deps.registryUrl ?? REGISTRY_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`registry answered ${res.status}`);
      const body = (await res.json()) as { version?: unknown };
      if (typeof body.version !== "string") throw new Error("registry sent no version");
      this.latest = body.version;
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
      this.deps.log?.(`updates: ${this.error}`);
    } finally {
      this.checkedAt = this.now();
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
