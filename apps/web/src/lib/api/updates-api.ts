import {
  CODEDEN_VERSION,
  HealthResponse,
  ReleaseNotes,
  type UpdateInstallRequest,
  UpdateStatus,
} from "@codeden/contracts";
import type { Fetcher } from "./http";

/** One-click self-update (§16): install, restart, roll back, release notes. */
export interface UpdatesApi {
  /** Install `version` (default: the latest) and restart into it unless `restart` is false. */
  install(req?: UpdateInstallRequest): Promise<UpdateStatus>;
  /** Restart into the installed version waiting for it. */
  restart(): Promise<UpdateStatus>;
  /** Go back to the previous version (restarts). */
  rollback(): Promise<UpdateStatus>;
  notes(version: string): Promise<ReleaseNotes>;
  /** The version answering `/api/health`, or null while the server is down (restarting). */
  serverVersion(): Promise<string | null>;
}

export function httpUpdatesApi(http: Fetcher, origin: string): UpdatesApi {
  const parse = (v: unknown) => UpdateStatus.parse(v);
  return {
    install: (req = {}) => http.post("/updates/install", req, parse),
    restart: () => http.post("/updates/restart", {}, parse),
    rollback: () => http.post("/updates/rollback", {}, parse),
    notes: (version) =>
      http.get(`/updates/notes?version=${encodeURIComponent(version)}`, (v) =>
        ReleaseNotes.parse(v),
      ),
    async serverVersion() {
      try {
        const res = await fetch(`${origin}/api/health`, { cache: "no-store" });
        const health = HealthResponse.safeParse(await res.json());
        return health.success ? health.data.version : null;
      } catch {
        return null;
      }
    },
  };
}

/** The mock client is always up to date and running from source. */
export function mockUpdatesApi(): UpdatesApi {
  const unavailable = () =>
    Promise.reject(new Error("You're running CodeBench from source: pull and rebuild to update."));
  return {
    install: unavailable,
    restart: unavailable,
    rollback: unavailable,
    notes: async (version) => ({
      version,
      body: `### What's new in ${version}\n\n- Mock release notes.`,
      url: `https://github.com/leonvanzyl/codeden/releases/tag/v${version}`,
    }),
    serverVersion: async () => CODEDEN_VERSION,
  };
}
