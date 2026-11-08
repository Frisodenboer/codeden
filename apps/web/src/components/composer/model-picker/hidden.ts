import type { ModelRow } from "./logic";

/** Hidden model ids by provider id (`settings.models.hidden`). */
export type HiddenModels = Record<string, string[]>;

export function isHidden(hidden: HiddenModels, providerId: string, modelId: string): boolean {
  return hidden[providerId]?.includes(modelId) ?? false;
}

/** A provider's hidden ids after hiding or showing one model. */
export function toggleHidden(hidden: HiddenModels, providerId: string, modelId: string): string[] {
  const ids = hidden[providerId] ?? [];
  return ids.includes(modelId) ? ids.filter((id) => id !== modelId) : [...ids, modelId];
}

/**
 * The rows a list shows. Hidden models are left out, everywhere (Favourites included), unless
 * a model is the current selection (a selection is never lost) or `showHidden` is on.
 * `hiddenCount` is how many hidden rows the toggle can reveal.
 */
export function visibleRows(
  rows: readonly ModelRow[],
  hidden: HiddenModels,
  selectedKey: string | null,
  showHidden: boolean,
): { rows: ModelRow[]; hiddenCount: number } {
  let hiddenCount = 0;
  const out: ModelRow[] = [];
  for (const row of rows) {
    const rowHidden = isHidden(hidden, row.provider.id, row.model.id);
    if (rowHidden && row.key !== selectedKey) {
      hiddenCount++;
      if (!showHidden) continue;
    }
    out.push(row);
  }
  return { rows: out, hiddenCount };
}
