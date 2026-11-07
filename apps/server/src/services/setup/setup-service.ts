import type {
  LoginCommandResponse,
  SetupCheck,
  SetupStatus,
  SetupToolId,
} from "@codeden/contracts";
import type { SettingsStore } from "../../settings-store";
import { errorMessage } from "../errors";
import type { Exec } from "../exec";
import type { BrowserProbe } from "./browsers";
import { CHECKS, type CheckEnv, LOGIN_COMMANDS } from "./checks";

export interface SetupServiceDeps {
  exec: Exec;
  settings: Pick<SettingsStore, "get" | "update">;
  /** Per-check timeout (default 20s); a slow CLI never blocks the checklist. */
  checkTimeoutMs?: number;
  /** Cached results are reused for this long unless a refresh is requested (default 5 min). */
  cacheMs?: number;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  browserProbe?: Partial<BrowserProbe>;
  now?: () => number;
}

const ORDER: SetupToolId[] = ["claude", "codex", "gh", "git", "browser", "node"];
const PROVIDERS: SetupToolId[] = ["claude", "codex"];

/**
 * First-run setup and re-checks on launch (§14). Runs every detection in parallel with a
 * timeout each, caches the result, and records which tools changed state since the last run.
 */
export class SetupService {
  private cached: SetupStatus | undefined;
  private running: Promise<SetupStatus> | undefined;

  constructor(private readonly deps: SetupServiceDeps) {}

  /** The last detection result, without re-checking (undefined before the first check). */
  get lastStatus(): SetupStatus | undefined {
    return this.cached;
  }

  /** Cached status, re-checked when stale or when `refresh` is set. */
  async status(opts: { refresh?: boolean } = {}): Promise<SetupStatus> {
    const now = this.now();
    const fresh =
      this.cached && now - Date.parse(this.cached.checkedAt) < (this.deps.cacheMs ?? 300_000);
    if (this.cached && fresh && !opts.refresh) {
      return { ...this.cached, setupCompleted: this.deps.settings.get().setup.completed };
    }
    this.running ??= this.runChecks().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Persist that the user finished the checklist. */
  complete(): SetupStatus["setupCompleted"] {
    this.deps.settings.update({
      setup: { completed: true, completedAt: new Date().toISOString() },
    });
    return true;
  }

  /** The command to run in a terminal to sign `tool` in. */
  loginCommand(tool: keyof typeof LOGIN_COMMANDS): LoginCommandResponse {
    const [command, ...args] = LOGIN_COMMANDS[tool];
    return { tool, command: [command, ...args].join(" "), args };
  }

  private async runChecks(): Promise<SetupStatus> {
    const env: CheckEnv = {
      exec: this.deps.exec,
      platform: this.deps.platform ?? process.platform,
      nodeVersion: this.deps.nodeVersion ?? process.version,
      now: this.now(),
      browserProbe: this.deps.browserProbe,
    };
    const checks = await Promise.all(ORDER.map((id) => this.timed(id, env)));
    const previous = this.cached;
    const warnings = checks
      .filter((c) => c.state === "warning" || this.regressed(previous, c))
      .map((c) => ({ id: c.id, message: c.message }));
    const status: SetupStatus = {
      checkedAt: new Date(this.now()).toISOString(),
      setupCompleted: this.deps.settings.get().setup.completed,
      ready: checks.some((c) => PROVIDERS.includes(c.id) && c.installed && c.loggedIn === true),
      checks,
      warnings,
    };
    this.cached = status;
    return status;
  }

  private regressed(previous: SetupStatus | undefined, check: SetupCheck): boolean {
    const before = previous?.checks.find((c) => c.id === check.id);
    return before?.state === "ok" && check.state === "missing";
  }

  private async timed(id: SetupToolId, env: CheckEnv): Promise<SetupCheck> {
    const started = this.now();
    const timeoutMs = this.deps.checkTimeoutMs ?? 20_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        CHECKS[id](env),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return { ...result, durationMs: Math.max(0, this.now() - started) };
    } catch (error) {
      return {
        id,
        label: id,
        state: "error",
        installed: false,
        version: null,
        executablePath: null,
        loggedIn: null,
        authMethod: null,
        account: null,
        loginExpiresAt: null,
        message: `Check failed: ${errorMessage(error)}`,
        fix: null,
        durationMs: Math.max(0, this.now() - started),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
