import type { ClaudeSdkStatus } from "@codeden/contracts";
import {
  CLAUDE_SDK_VERSION,
  claudeSdkSource,
  type InstallClaudeSdkOptions,
  importClaudeSdkFrom,
  installClaudeSdk,
  isClaudeSdkInstalled,
} from "@codeden/providers";
import { errorMessage } from "../errors";

export interface ClaudeSdkServiceDeps {
  /** `<home>/deps`. */
  depsDir: string;
  /** Defaults to the build's source (`deps` in the published package). */
  source?: () => "deps" | "workspace";
  install?: (opts: InstallClaudeSdkOptions) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * Claude Code support (§14): reports and installs the Claude Agent SDK into `<home>/deps`.
 * One install at a time; the UI polls `status()` for progress while it runs.
 */
export class ClaudeSdkService {
  private running: Promise<void> | undefined;
  private progress: string | null = null;
  private error: string | null = null;

  constructor(private readonly deps: ClaudeSdkServiceDeps) {}

  status(): ClaudeSdkStatus {
    const source = (this.deps.source ?? claudeSdkSource)();
    const base = { version: CLAUDE_SDK_VERSION, source };
    if (source === "workspace") {
      return { ...base, state: "ready", location: null, progress: null, error: null };
    }
    const state = this.running
      ? "installing"
      : isClaudeSdkInstalled(this.deps.depsDir)
        ? "ready"
        : this.error
          ? "failed"
          : "missing";
    return {
      ...base,
      state,
      location: this.deps.depsDir,
      progress: state === "installing" ? this.progress : null,
      error: state === "failed" ? this.error : null,
    };
  }

  /** Start the install (or join the running one) and return the status right away. */
  install(): ClaudeSdkStatus {
    const current = this.status();
    if (current.state === "ready" || current.state === "installing") return current;
    this.error = null;
    this.progress = "Starting";
    const install = this.deps.install ?? installClaudeSdk;
    this.running = install({
      depsDir: this.deps.depsDir,
      onProgress: (line) => {
        this.progress = line;
      },
    })
      .then(() => importClaudeSdkFrom(this.deps.depsDir))
      .then(
        () => this.deps.log?.(`Claude Code support installed (${CLAUDE_SDK_VERSION})`),
        (error: unknown) => {
          this.error = errorMessage(error);
          this.deps.log?.(`Claude Code support install failed: ${this.error}`);
        },
      )
      .finally(() => {
        this.running = undefined;
        this.progress = null;
      });
    return this.status();
  }

  /** Resolves when the running install (if any) settles. */
  async settled(): Promise<ClaudeSdkStatus> {
    await this.running;
    return this.status();
  }
}
