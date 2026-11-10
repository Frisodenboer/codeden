import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderStatus,
  ReasoningEffort,
  SessionOptions,
} from "@codeden/contracts";
import type { ProviderAdapter, ProviderSession } from "../adapter";
import { ModelCatalog } from "../models";
import type { ResolvedCommand } from "../util/exec";
import { findExecutable, quickLocate } from "../util/locate";
import type { UtilityModel } from "../utility";
import { detectClaude } from "./detect";
import { listClaudeModels, toModelInfos } from "./models";
import { ClaudeUtilityModel } from "./one-shot";
import { type ClaudeSdkModule, claudeSdkReady, loadClaudeSdk } from "./sdk";
import { ClaudeSession } from "./session";

export const CLAUDE_PROVIDER_ID = "claude";

const capabilities: ProviderCapabilities = {
  resume: true,
  steer: true,
  interrupt: true,
  approvals: true,
  userQuestions: true,
  subagents: true,
  rollback: false,
  fork: false,
  images: true,
  planMode: true,
  reasoningEffort: true,
  mcp: true,
  skills: true,
  // CodeDen's policy gates every tool call, so a change applies from the next one.
  liveAutonomy: true,
  readOnly: true,
};

const EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** Fallback model list (CLI aliases) until discovery or a session reports the real one. */
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "default",
    label: "Default",
    description: "Claude Code's default model",
    efforts: EFFORTS,
    isDefault: true,
  },
  { id: "opus", label: "Opus", efforts: EFFORTS },
  { id: "sonnet", label: "Sonnet", efforts: EFFORTS },
  { id: "haiku", label: "Haiku", efforts: [] },
];

export interface ClaudeAdapterOptions {
  /** Override executable resolution (tests, custom installs). */
  executable?: ResolvedCommand;
  /** Max time for model discovery, CLI start-up included. */
  modelListTimeoutMs?: number;
  /**
   * Load the SDK (tests stub it). By default discovery uses `loadClaudeSdk()`, and only when
   * the SDK is ready without an install (`claudeSdkReady()`).
   */
  loadSdk?: () => Promise<Pick<ClaudeSdkModule, "query">>;
}

/** Claude Code through the Claude Agent SDK and the user's installed `claude` (§7.2). */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = CLAUDE_PROVIDER_ID;
  readonly displayName = "Claude Code";
  private readonly catalog = new ModelCatalog(FALLBACK_MODELS);
  private refreshing: Promise<void> | undefined;
  private cachedExe: ResolvedCommand | undefined;

  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  /** The copy sessions run: the one `detect()` validated, else the first plausible one. */
  private executable(): ResolvedCommand | undefined {
    this.cachedExe ??= this.options.executable ?? quickLocate("claude");
    return this.cachedExe;
  }

  /** Re-detect: the working copy found here (a native install off PATH counts) is kept. */
  async detect(): Promise<ProviderStatus> {
    if (this.options.executable) return detectClaude({ executable: this.options.executable });
    const lookup = await findExecutable("claude");
    this.cachedExe = lookup.command;
    return detectClaude({ lookup });
  }

  capabilities(): ProviderCapabilities {
    return { ...capabilities };
  }

  models(): ModelInfo[] {
    return this.catalog.list();
  }

  onModelsChanged(listener: () => void): () => void {
    return this.catalog.subscribe(listener);
  }

  /**
   * Load Claude Code's model list without a turn (`listClaudeModels`: the CLI starts and
   * answers `initialize`; no message is sent). Concurrent calls share one discovery; a failed
   * discovery keeps the last list. Skipped when Claude Code is not installed, or when the SDK
   * would have to be installed first. Never throws.
   */
  refreshModels(): Promise<void> {
    this.refreshing ??= this.discoverModels().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  async openSession(opts: SessionOptions): Promise<ProviderSession> {
    const executable = this.executable();
    if (!executable) throw new Error("Claude Code is not installed (no `claude` on PATH)");
    const { query } = await loadClaudeSdk();
    return new ClaudeSession(opts, {
      executable,
      query,
      onModels: (models) => {
        if (models.length) this.catalog.set(toModelInfos(models));
      },
    });
  }

  utilityModel(): UtilityModel {
    return new ClaudeUtilityModel(() => this.executable());
  }

  private async discoverModels(): Promise<void> {
    const exe = this.executable();
    if (!exe) return;
    const load = this.options.loadSdk ?? (claudeSdkReady() ? loadClaudeSdk : undefined);
    if (!load) return;
    try {
      const { query } = await load();
      const models = await listClaudeModels(query, exe, {
        timeoutMs: this.options.modelListTimeoutMs,
      });
      if (models.length) this.catalog.set(models);
    } catch {
      // Keep the last list (the aliases, or what discovery or a session reported before).
    }
  }
}
