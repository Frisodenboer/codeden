import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderStatus,
  ReasoningEffort,
  SessionOptions,
} from "@codeden/contracts";
import type { ProviderAdapter, ProviderSession } from "../adapter";
import { ModelCatalog } from "../models";
import { type ResolvedCommand, resolveExecutable } from "../util/exec";
import type { UtilityModel } from "../utility";
import { detectClaude } from "./detect";
import { ClaudeUtilityModel } from "./one-shot";
import { loadClaudeSdk } from "./sdk";
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
};

const EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** Fallback model list (CLI aliases) until a session reports the real one. */
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
}

/** Claude Code through the Claude Agent SDK and the user's installed `claude` (§7.2). */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = CLAUDE_PROVIDER_ID;
  readonly displayName = "Claude Code";
  private readonly catalog = new ModelCatalog(FALLBACK_MODELS);
  private cachedExe: ResolvedCommand | undefined;

  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  private executable(): ResolvedCommand | undefined {
    this.cachedExe ??= this.options.executable ?? resolveExecutable("claude");
    return this.cachedExe;
  }

  detect(): Promise<ProviderStatus> {
    this.cachedExe = undefined;
    return detectClaude({ executable: this.executable() });
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

  async openSession(opts: SessionOptions): Promise<ProviderSession> {
    const executable = this.executable();
    if (!executable) throw new Error("Claude Code is not installed (no `claude` on PATH)");
    const { query } = await loadClaudeSdk();
    return new ClaudeSession(opts, {
      executable,
      query,
      onModels: (models) => {
        if (!models.length) return;
        this.catalog.set(
          models.map((m, i) => ({
            id: m.value,
            label: m.displayName || m.value,
            ...(m.description ? { description: m.description } : {}),
            efforts: (m.supportedEffortLevels ?? []) as ReasoningEffort[],
            ...(i === 0 ? { isDefault: true } : {}),
          })),
        );
      },
    });
  }

  utilityModel(): UtilityModel {
    return new ClaudeUtilityModel(() => this.executable());
  }
}
