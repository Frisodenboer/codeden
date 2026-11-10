import type { ModelInfo, ProviderInfo } from "@codeden/contracts";

/**
 * Stored model id meaning "the provider's default model", like `null`. The server never sends it
 * to a provider; before discovery a provider may also list a real entry with this id.
 */
export const DEFAULT_MODEL_ID = "default";

/** Normalized words of an id or a name: `claude-opus-5-5` and `Opus 5.5` → `claude opus 5 5`. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_\-.]+/g, " ")
    .trim();

/**
 * The listed entry that runs a full model id the list doesn't carry itself, e.g. a session on
 * `claude-opus-5-5` while the provider lists the alias `opus` (Opus 5.5). The entry's
 * `resolvedId` decides; without one, a versioned name that ends the id ("Opus 5.5" for
 * `claude-opus-5-5`), from the label or the description's first part ("Opus 5.5 · …").
 * Named entries win over "the default" entry, which runs the same model.
 */
export function aliasFor(
  provider: ProviderInfo | undefined,
  modelId: string,
): ModelInfo | undefined {
  const models = provider?.models ?? [];
  const named = (list: ModelInfo[]) => list.find((m) => m.id !== DEFAULT_MODEL_ID) ?? list[0];
  const byResolved = models.filter((m) => m.resolvedId === modelId);
  if (byResolved.length) return named(byResolved);
  const id = words(modelId);
  const endsId = (name: string | undefined) => {
    const key = words(name ?? "");
    return /\d/.test(key) && (id === key || id.endsWith(` ${key}`));
  };
  const byLabel = models.filter((m) => endsId(m.label));
  if (byLabel.length) return named(byLabel);
  return named(models.filter((m) => endsId(m.description?.split("·")[0])));
}
