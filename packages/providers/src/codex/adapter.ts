import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderStatus,
  ReasoningEffort,
  SessionOptions,
} from "@codeden/contracts";
import { ReasoningEffort as ReasoningEffortSchema } from "@codeden/contracts";
import type { ProviderAdapter, ProviderSession } from "../adapter";
import { type ResolvedCommand, resolveExecutable } from "../util/exec";
import type { UtilityModel } from "../utility";
import { detectCodex } from "./detect";
import { CodexUtilityModel } from "./one-shot";
import type { Model } from "./protocol/v2";
import { CodexSession } from "./session";

export const CODEX_PROVIDER_ID = "codex";

/**
 * Honest flags: subagents (collab agents) are experimental in app-server and not surfaced as
 * child threads yet; rollback/fork exist in the protocol but are not wired up.
 */
const capabilities: ProviderCapabilities = {
  resume: true,
  steer: true,
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
  skills: true,
};

const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "default",
    label: "Default",
    description: "The model configured in ~/.codex/config.toml",
    efforts: ["minimal", "low", "medium", "high", "xhigh"],
    isDefault: true,
  },
];

export interface CodexAdapterOptions {
  executable?: ResolvedCommand;
}

/** Map an app-server `Model` to CodeDen's `ModelInfo`. */
export function modelInfoFromCodex(m: Model): ModelInfo {
  const efforts = m.supportedReasoningEfforts
    .map((e) => e.reasoningEffort)
    .filter((e): e is ReasoningEffort => ReasoningEffortSchema.safeParse(e).success);
  const defaultEffort = ReasoningEffortSchema.safeParse(m.defaultReasoningEffort);
  return {
    id: m.model,
    label: m.displayName || m.model,
    ...(m.description ? { description: m.description } : {}),
    efforts,
    ...(defaultEffort.success ? { defaultEffort: defaultEffort.data } : {}),
    ...(m.isDefault ? { isDefault: true } : {}),
  };
}

/** Codex through `codex app-server` JSON-RPC (§7.2). */
export class CodexAdapter implements ProviderAdapter {
  readonly id = CODEX_PROVIDER_ID;
  readonly displayName = "Codex";
  private modelList: ModelInfo[] = FALLBACK_MODELS;
  private cachedExe: ResolvedCommand | undefined;

  constructor(private readonly options: CodexAdapterOptions = {}) {}

  private executable(): ResolvedCommand | undefined {
    this.cachedExe ??= this.options.executable ?? resolveExecutable("codex");
    return this.cachedExe;
  }

  detect(): Promise<ProviderStatus> {
    this.cachedExe = undefined;
    return detectCodex({ executable: this.executable() });
  }

  capabilities(): ProviderCapabilities {
    return { ...capabilities };
  }

  models(): ModelInfo[] {
    return this.modelList.map((m) => ({ ...m }));
  }

  async openSession(opts: SessionOptions): Promise<ProviderSession> {
    const executable = this.executable();
    if (!executable) throw new Error("Codex is not installed (no `codex` on PATH)");
    const session = new CodexSession(opts, {
      executable,
      onModels: (models) => {
        const visible = models.filter((m) => !m.hidden).map(modelInfoFromCodex);
        if (visible.length) this.modelList = visible;
      },
    });
    try {
      await session.start();
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
  }

  utilityModel(): UtilityModel {
    return new CodexUtilityModel(() => this.executable());
  }
}
