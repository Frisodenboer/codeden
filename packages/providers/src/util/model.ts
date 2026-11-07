/** The id the model pickers use for "the provider's own default model". */
export const DEFAULT_MODEL_ID = "default";

/**
 * The model to pass to a provider, or undefined to leave it out so the provider uses its own
 * default (the user's config). `"default"` and empty values are never sent as model ids.
 */
export function explicitModel(model: string | null | undefined): string | undefined {
  const id = model?.trim();
  return id && id !== DEFAULT_MODEL_ID ? id : undefined;
}
