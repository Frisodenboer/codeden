import type { ModelInfo, ReasoningEffort } from "@codeden/contracts";
import { ReasoningEffort as ReasoningEffortSchema } from "@codeden/contracts";
import { DEFAULT_MODEL_ID } from "../util/model";
import type { OcModel, OcProvidersResponse } from "./types";

/** Effort order, for picking a default variant. */
const EFFORT_ORDER: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** CodeBench model id for an opencode model: `provider/model`, e.g. `zai-coding-plan/glm-5.3`. */
export function opencodeModelId(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

/**
 * Split a CodeBench model id into opencode's `{ providerID, modelID }`. The model part may
 * itself contain slashes (`openrouter/anthropic/claude-x`); only the first one separates.
 */
export function splitOpencodeModel(
  id: string,
): { providerID: string; modelID: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) };
}

/** The model's variants that are CodeBench efforts (`low`, `high`, `max`...), in effort order. */
export function opencodeEfforts(m: OcModel): ReasoningEffort[] {
  const names = Object.keys(m.variants ?? {});
  return EFFORT_ORDER.filter(
    (e) => names.includes(e) && ReasoningEffortSchema.safeParse(e).success,
  );
}

/** Map one opencode model to `ModelInfo`. */
export function modelInfoFromOpencode(m: OcModel, providerName: string): ModelInfo {
  const efforts = opencodeEfforts(m);
  const context = m.limit?.context;
  return {
    id: opencodeModelId(m.providerID, m.id),
    label: m.name || m.id,
    description: `${providerName} via opencode`,
    efforts,
    ...(efforts.includes("high") ? { defaultEffort: "high" as const } : {}),
    ...(context && context > 0 ? { contextWindow: Math.round(context) } : {}),
  };
}

const DEFAULT_ENTRY: ModelInfo = {
  id: DEFAULT_MODEL_ID,
  label: "Default",
  description: "The model configured in opencode (opencode.jsonc)",
  efforts: [],
  isDefault: true,
};

/**
 * The models of every provider opencode can use (those with a login or a key), plus a
 * "Default" entry that leaves the choice to opencode's config. Deprecated models are left out.
 */
export function opencodeModels(res: OcProvidersResponse): ModelInfo[] {
  const out: ModelInfo[] = [{ ...DEFAULT_ENTRY }];
  for (const provider of res.providers ?? []) {
    for (const m of Object.values(provider.models ?? {})) {
      if (m.status === "deprecated") continue;
      out.push(
        modelInfoFromOpencode({ ...m, providerID: m.providerID ?? provider.id }, provider.name),
      );
    }
  }
  return out;
}

/** The context window of a CodeBench model id, from a model list. */
export function contextWindowOf(
  models: readonly ModelInfo[],
  id: string | undefined,
): number | undefined {
  if (!id) return undefined;
  return models.find((m) => m.id === id)?.contextWindow;
}
