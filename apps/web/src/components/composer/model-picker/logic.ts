import type { ModelInfo, ProviderInfo, ReasoningEffort, SetupCheck } from "@codeden/contracts";

/**
 * Pure rules behind the provider, model and effort picker. Nothing here branches on a provider
 * id: models, effort levels and capabilities all come from the provider itself.
 */

/** What the picker edits. `model: null` and `effort: null` mean "use the default". */
export interface ModelChoice {
  provider: string;
  model: string | null;
  effort: ReasoningEffort | null;
}

export const EFFORT_ORDER: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const EFFORT_NAME: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** A model's effort levels from lowest to highest, without duplicates. */
export function sortEfforts(efforts: readonly ReasoningEffort[]): ReasoningEffort[] {
  return EFFORT_ORDER.filter((e) => efforts.includes(e));
}

/**
 * Stored model id meaning "the provider's default model", like `null`. The server never sends it
 * to a provider; before discovery a provider may also list a real entry with this id.
 */
export const DEFAULT_MODEL_ID = "default";

/** The model a choice points at, and how it got there. */
export interface ResolvedModel {
  model: ModelInfo | undefined;
  /** The choice is "the default" (null or `default`), resolved to the provider's default model. */
  followsDefault: boolean;
  /** A stored id the provider no longer lists; shown as-is rather than swapped for another. */
  missing: string | null;
}

/**
 * Resolve a stored model id: an exact match; `null` or `default` as the provider's default model
 * (its `isDefault` entry, else its first); anything else as missing.
 */
export function resolveModel(
  provider: ProviderInfo | undefined,
  modelId: string | null,
): ResolvedModel {
  const exact = modelId !== null ? provider?.models.find((m) => m.id === modelId) : undefined;
  if (exact) return { model: exact, followsDefault: false, missing: null };
  if (modelId === null || modelId === DEFAULT_MODEL_ID) {
    const listed = provider?.models.find((m) => m.id === DEFAULT_MODEL_ID);
    if (listed) return { model: listed, followsDefault: false, missing: null };
    const model = provider?.models.find((m) => m.isDefault) ?? provider?.models[0];
    return { model, followsDefault: Boolean(model), missing: null };
  }
  return { model: undefined, followsDefault: false, missing: modelId };
}

/** How a resolved model is named: "Default (x)" when it follows the provider's default. */
export function modelName(resolved: ResolvedModel): string | null {
  if (resolved.missing) return resolved.missing;
  if (!resolved.model) return null;
  return resolved.followsDefault ? `Default (${resolved.model.label})` : resolved.model.label;
}

/** Effort levels the picker should offer for a model (none when the provider has no effort). */
export function effortLevels(
  provider: ProviderInfo | undefined,
  model: ModelInfo | undefined,
): ReasoningEffort[] {
  if (!provider?.capabilities.reasoningEffort || !model) return [];
  return sortEfforts(model.efforts);
}

/**
 * Keep an effort valid for a model. A supported value is kept; otherwise the model's default,
 * otherwise the nearest supported level. Models without levels get `null`, and `null` (use the
 * default) stays `null`.
 */
export function clampEffort(
  levels: readonly ReasoningEffort[],
  effort: ReasoningEffort | null,
  defaultEffort?: ReasoningEffort,
): ReasoningEffort | null {
  if (levels.length === 0 || effort === null) return null;
  if (levels.includes(effort)) return effort;
  if (defaultEffort && levels.includes(defaultEffort)) return defaultEffort;
  const want = EFFORT_ORDER.indexOf(effort);
  let best = levels[0] ?? null;
  for (const level of levels) {
    const distance = Math.abs(EFFORT_ORDER.indexOf(level) - want);
    if (best === null || distance < Math.abs(EFFORT_ORDER.indexOf(best) - want)) best = level;
  }
  return best;
}

/** The effort that will actually run: the chosen one if valid, else the model's default. */
export function effectiveEffort(
  levels: readonly ReasoningEffort[],
  effort: ReasoningEffort | null,
  defaultEffort?: ReasoningEffort,
): ReasoningEffort | null {
  if (levels.length === 0) return null;
  const chosen = clampEffort(levels, effort, defaultEffort);
  if (chosen) return chosen;
  if (defaultEffort && levels.includes(defaultEffort)) return defaultEffort;
  return levels[Math.floor((levels.length - 1) / 2)] ?? null;
}

/** The choice after picking a model: the effort is clamped to what that model supports. */
export function chooseModel(
  current: ModelChoice,
  provider: ProviderInfo,
  model: ModelInfo,
): ModelChoice {
  const levels = effortLevels(provider, model);
  return {
    provider: provider.id,
    model: model.id,
    effort: clampEffort(levels, current.effort, model.defaultEffort),
  };
}

// ---------------------------------------------------------------- availability

/** Whether a provider can start sessions on this machine, and why not. */
export interface Availability {
  ready: boolean;
  /** Short reason, e.g. "Not signed in". Null when ready. */
  reason: string | null;
  /** The detection message, e.g. "Installed (0.58.0) but not signed in". */
  detail: string | null;
  /** The command that fixes it, when detection knows one. */
  command: string | null;
}

const READY: Availability = { ready: true, reason: null, detail: null, command: null };

/**
 * Availability from the setup checks, matched by provider id. A provider without a check (or
 * before the first check finishes) counts as ready: the runner loaded it.
 */
export function providerAvailability(
  providerId: string,
  checks: readonly SetupCheck[] | undefined,
): Availability {
  const check = checks?.find((c) => c.id === providerId);
  if (!check || check.state === "ok" || check.state === "warning") return READY;
  const reason = !check.installed
    ? "Not installed"
    : check.loggedIn === false
      ? "Not signed in"
      : "Not ready";
  return { ready: false, reason, detail: check.message, command: check.fix?.command ?? null };
}

// ---------------------------------------------------------------- tabs and search

/**
 * One tab in the provider rail. Only providers today; the union leaves room for collections
 * such as favourites without changing how the rail and list render.
 */
export type PickerTab = {
  kind: "provider";
  id: string;
  provider: ProviderInfo;
  availability: Availability;
  /** Set when the tab cannot be opened, e.g. a session's provider is fixed. */
  lockedReason: string | null;
};

export function providerTabs(
  providers: readonly ProviderInfo[],
  checks: readonly SetupCheck[] | undefined,
  lockedProvider: string | undefined,
): PickerTab[] {
  return providers.map((provider) => ({
    kind: "provider" as const,
    id: provider.id,
    provider,
    availability: providerAvailability(provider.id, checks),
    lockedReason:
      lockedProvider && provider.id !== lockedProvider
        ? `${provider.displayName} can't be used in this session. Start a new session to switch providers.`
        : null,
  }));
}

/** The next tab that can be opened, wrapping around; used by the provider shortcuts. */
export function adjacentTab(
  tabs: readonly PickerTab[],
  currentId: string,
  direction: 1 | -1,
): PickerTab | undefined {
  const open = tabs.filter((t) => !t.lockedReason);
  if (open.length === 0) return undefined;
  const index = open.findIndex((t) => t.id === currentId);
  if (index < 0) return direction === 1 ? open[0] : open.at(-1);
  return open[(index + direction + open.length) % open.length];
}

/** A row in the model list. */
export interface ModelRow {
  key: string;
  provider: ProviderInfo;
  model: ModelInfo;
}

export function rowKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function rows(provider: ProviderInfo): ModelRow[] {
  return provider.models.map((model) => ({ key: rowKey(provider.id, model.id), provider, model }));
}

/** The rows of one tab. */
export function tabRows(tab: PickerTab): ModelRow[] {
  return rows(tab.provider);
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_\-.]+/g, " ")
    .trim();

/** Lower is better; null when a search token matches nothing. */
function scoreRow(row: ModelRow, tokens: string[], phrase: string): number | null {
  const label = normalize(row.model.label);
  if (phrase === label || phrase === normalize(row.model.id)) return -100;
  const fields = [
    label,
    normalize(row.model.id),
    normalize(row.provider.displayName),
    normalize(row.model.description ?? ""),
  ];
  let score = 0;
  for (const token of tokens) {
    let best: number | null = null;
    fields.forEach((field, i) => {
      const at = field.indexOf(token);
      if (at < 0) return;
      const where = at === 0 ? 0 : field[at - 1] === " " ? 1 : 2;
      const s = i * 10 + where;
      if (best === null || s < best) best = s;
    });
    if (best === null) return null;
    score += best;
  }
  return score;
}

/** Rank models across providers for a search; ties keep provider and model order. */
export function searchRows(providers: readonly ProviderInfo[], query: string): ModelRow[] {
  const phrase = normalize(query);
  const tokens = phrase.split(" ").filter(Boolean);
  const all = providers.flatMap(rows);
  if (tokens.length === 0) return all;
  return all
    .map((row, order) => ({ row, order, score: scoreRow(row, tokens, phrase) }))
    .filter((r): r is { row: ModelRow; order: number; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((r) => r.row);
}

/**
 * What the trigger names: the model ("Default (x)" when it follows the default), or
 * "Provider · Model" when the provider lists a single model, such as its fallback "Default".
 */
export function triggerText(provider: ProviderInfo | undefined, resolved: ResolvedModel) {
  const name = modelName(resolved);
  if (!provider) return name ?? "Choose a model";
  if (!name) return provider.displayName;
  return provider.models.length <= 1 && !resolved.missing
    ? `${provider.displayName} · ${name}`
    : name;
}
