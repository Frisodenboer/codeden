import type { CustomModel, ModelInfo, ProviderInfo } from "@codeden/contracts";
import { resolveModel } from "./logic";

/** Custom model ids by provider id (`settings.models.custom`). */
export type CustomModels = Record<string, CustomModel[]>;

/** Description a custom model shows in the picker. */
export const CUSTOM_DESCRIPTION = "Custom model id, sent to the provider as is";

/**
 * Effort levels for a custom model: those of the provider's default model, or none when the
 * provider has no effort levels (`capabilities.reasoningEffort`). Never guessed per provider.
 */
export function customEfforts(
  provider: ProviderInfo,
): Pick<ModelInfo, "efforts" | "defaultEffort"> {
  if (!provider.capabilities.reasoningEffort) return { efforts: [] };
  const base = resolveModel(provider, null).model;
  if (!base) return { efforts: [] };
  return {
    efforts: [...base.efforts],
    ...(base.defaultEffort ? { defaultEffort: base.defaultEffort } : {}),
  };
}

/**
 * True when `modelId` is one of the provider's custom models and the provider (as it reports
 * itself, before `withCustomModels`) doesn't list it.
 */
export function isCustom(
  custom: CustomModels,
  listed: ProviderInfo | undefined,
  providerId: string,
  modelId: string,
): boolean {
  if (!custom[providerId]?.some((m) => m.id === modelId)) return false;
  return !listed?.models.some((m) => m.id === modelId);
}

/**
 * Providers with their custom models appended after the listed ones. A custom id the provider
 * already lists is left out (the listed model wins). Providers without custom models are
 * returned as they are.
 */
export function withCustomModels(
  providers: readonly ProviderInfo[],
  custom: CustomModels,
): ProviderInfo[] {
  return providers.map((provider) => {
    const extra = (custom[provider.id] ?? []).filter(
      (c) => !provider.models.some((m) => m.id === c.id),
    );
    if (extra.length === 0) return provider;
    const efforts = customEfforts(provider);
    return {
      ...provider,
      models: [
        ...provider.models,
        ...extra.map((c) => ({
          id: c.id,
          label: c.label ?? c.id,
          description: CUSTOM_DESCRIPTION,
          ...efforts,
          efforts: [...efforts.efforts],
        })),
      ],
    };
  });
}

/**
 * A provider's custom models after adding one, or why it can't be added: the id is empty, or
 * the provider already has it (listed or custom).
 */
export function addCustomModel(
  list: readonly CustomModel[],
  provider: ProviderInfo,
  entry: { id: string; label?: string },
): { list: CustomModel[] } | { error: string } {
  const id = entry.id.trim();
  const label = entry.label?.trim();
  if (!id) return { error: "Enter a model id" };
  if (list.some((m) => m.id === id)) return { error: `${id} is already a custom model` };
  if (provider.models.some((m) => m.id === id)) {
    return { error: `${provider.displayName} already lists ${id}` };
  }
  return { list: [...list, { id, ...(label ? { label } : {}) }] };
}

/** A provider's custom models without `id`. */
export function removeCustomModel(list: readonly CustomModel[], id: string): CustomModel[] {
  return list.filter((m) => m.id !== id);
}
