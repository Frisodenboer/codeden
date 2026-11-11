import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderStatus,
  SessionOptions,
} from "@codeden/contracts";
import type { ProviderAdapter, ProviderSession, RefreshModelsOptions } from "../adapter";
import { executableFingerprint, ModelFreshness } from "../freshness";
import { ModelCatalog } from "../models";
import type { ResolvedCommand } from "../util/exec";
import { quickLocate } from "../util/locate";
import { DEFAULT_MODEL_ID } from "../util/model";
import { detectOpencode } from "./detect";
import { opencodeModels } from "./models";
import { OpencodeServer, type OpencodeServerOptions } from "./process";
import { OpencodeSession } from "./session";

export const OPENCODE_PROVIDER_ID = "opencode";

/**
 * Honest flags (Principle 5). No steering: a message for a running turn waits for the next
 * one. Subagents (opencode's `task` tool) are not surfaced as child threads yet. opencode asks
 * CodeBench for every edit, command and fetch, and CodeBench answers by the permission level
 * (`./policy`), so level changes apply live and read-only is enforced on every request.
 */
const capabilities: ProviderCapabilities = {
  resume: true,
  steer: false,
  interrupt: true,
  approvals: true,
  userQuestions: true,
  subagents: false,
  rollback: false,
  fork: false,
  images: true,
  planMode: false,
  reasoningEffort: true,
  mcp: true,
  skills: false,
  liveAutonomy: true,
  // Edits are refused and commands checked against the read-only allowlist on every request.
  readOnly: true,
};

function fallbackModels(note?: string): ModelInfo[] {
  const base = "The model configured in opencode (opencode.jsonc)";
  return [
    {
      id: DEFAULT_MODEL_ID,
      label: "Default",
      description: note ? `${base}. ${note}` : base,
      efforts: [],
      isDefault: true,
    },
  ];
}

export interface OpencodeAdapterOptions {
  executable?: ResolvedCommand;
  server?: OpencodeServerOptions;
}

/** opencode through one shared `opencode serve` per runner (HTTP + server-sent events). */
export class OpencodeAdapter implements ProviderAdapter {
  readonly id = OPENCODE_PROVIDER_ID;
  readonly displayName = "opencode";
  private readonly catalog = new ModelCatalog(fallbackModels());
  private listed = false;
  private readonly freshness = new ModelFreshness();
  private refreshing: Promise<void> | undefined;
  private readonly server: OpencodeServer;

  constructor(private readonly options: OpencodeAdapterOptions = {}) {
    this.server = new OpencodeServer(() => this.executable(), options.server);
  }

  /** Looked up every time: the runner outlives updates and reinstalls. */
  private executable(): ResolvedCommand | undefined {
    return this.options.executable ?? quickLocate("opencode");
  }

  detect(): Promise<ProviderStatus> {
    return detectOpencode(this.options.executable ? { executable: this.options.executable } : {});
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
   * Load the models of every provider opencode is logged in to (`GET /config/providers`),
   * starting the shared server if needed. Never throws.
   */
  refreshModels(opts: RefreshModelsOptions = {}): Promise<void> {
    if (
      opts.maxAgeMs !== undefined &&
      this.freshness.isFresh(executableFingerprint(this.executable()), opts.maxAgeMs)
    ) {
      return this.refreshing ?? Promise.resolve();
    }
    this.refreshing ??= this.discoverModels().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  async openSession(opts: SessionOptions): Promise<ProviderSession> {
    if (!this.executable()) throw new Error("opencode is not installed (no `opencode` on PATH)");
    if (!this.listed) await this.refreshModels();
    const session = new OpencodeSession(opts, {
      server: this.server,
      modelEfforts: (model) => this.catalog.list().find((m) => m.id === model)?.efforts,
      contextWindow: (model) => this.catalog.list().find((m) => m.id === model)?.contextWindow,
    });
    try {
      await session.start();
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
  }

  /** Stop the shared server (runner shutdown). */
  async dispose(): Promise<void> {
    await this.server.stop();
  }

  private async discoverModels(): Promise<void> {
    const exe = this.executable();
    if (!exe) return;
    try {
      const client = await this.server.client();
      const models = opencodeModels(await client.providers());
      if (models.length > 1) {
        this.listed = true;
        this.freshness.confirm(executableFingerprint(exe));
        this.catalog.set(models);
      } else if (!this.listed) {
        this.catalog.set(
          fallbackModels("opencode lists no models; add a login with `opencode auth login`."),
        );
      }
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      if (!this.listed)
        this.catalog.set(fallbackModels(`opencode's model list could not be loaded: ${reason}`));
    }
  }
}
