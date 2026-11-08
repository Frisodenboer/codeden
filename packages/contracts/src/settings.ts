import { z } from "zod";
import { AutonomyLevel, ProviderId, QuietHours, ReasoningEffort } from "./common";
import { UpdateMode } from "./updates";

/** `auto` lets CodeDen pick the first ready provider (Claude, then Codex). */
export const ProviderChoice = z.union([z.literal("auto"), ProviderId]);
export type ProviderChoice = z.infer<typeof ProviderChoice>;

/** Image engine choice (§12.5): `auto` picks Codex when logged in, `none` hides the tool. */
export const ImageEngineSetting = z.enum(["auto", "codex", "gemini", "openai", "none"]);
export type ImageEngineSetting = z.infer<typeof ImageEngineSetting>;

/** Per-project image generation override; unset fields fall back to the global settings. */
export const ImageGenerationOverride = z.object({
  engine: ImageEngineSetting.optional(),
  defaultSize: z.string().optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  /** Images per day for this project (counted on its own, inside the global cap). */
  dailyCap: z.int().nonnegative().optional(),
});
export type ImageGenerationOverride = z.infer<typeof ImageGenerationOverride>;

/** Default provider/model/effort for one role. */
export const RoleDefaults = z.object({
  provider: ProviderChoice.default("auto"),
  model: z.string().nullable().default(null),
  effort: ReasoningEffort.nullable().default(null),
});
export type RoleDefaults = z.infer<typeof RoleDefaults>;

/** A model named by its provider and the provider's model id. */
export const ModelRef = z.object({
  provider: ProviderId,
  model: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRef>;

/**
 * User settings persisted in `<home>/settings.json` (non-secret; API keys live in the OS
 * keychain). Every field has a default, so `Settings.parse({})` yields a complete object and
 * older files keep working as fields are added.
 */
export const Settings = z.object({
  schemaVersion: z.literal(1).default(1),
  appearance: z
    .object({
      theme: z.enum(["system", "dark", "light"]).default("dark"),
    })
    .prefault({}),
  /** Default autonomy level (§11.2), overridable per project and session. */
  autonomy: z
    .object({
      default: AutonomyLevel.default("auto"),
    })
    .prefault({}),
  providers: z
    .object({
      orchestrator: RoleDefaults.prefault({}),
      pm: RoleDefaults.prefault({}),
      agent: RoleDefaults.prefault({}),
    })
    .prefault({}),
  /** Small, cheap model for side jobs (§7.4). */
  utilityModel: z
    .object({
      provider: ProviderChoice.default("auto"),
      model: z.string().nullable().default(null),
      jobs: z
        .object({
          followups: z.boolean().default(true),
          readAloudSummary: z.boolean().default(true),
          sessionTitles: z.boolean().default(true),
          noticeSummaries: z.boolean().default(true),
        })
        .prefault({}),
    })
    .prefault({}),
  /** The model picker (§13). */
  models: z
    .object({
      /**
       * Starred models, listed in this order in the picker's Favourites section. Entries whose
       * model a provider no longer lists are kept (it may come back) but not shown.
       */
      favorites: z.array(ModelRef).default([]),
    })
    .prefault({}),
  /** Follow-up prompt chips (§7.5). */
  followups: z
    .object({
      enabled: z.boolean().default(true),
      /** Send immediately on click instead of filling the composer. */
      sendOnClick: z.boolean().default(false),
    })
    .prefault({}),
  /** Voice (§11.3). */
  voice: z
    .object({
      dictation: z
        .object({
          engine: z.enum(["browser", "elevenlabs", "openai"]).default("browser"),
          pushToTalkShortcut: z.string().nullable().default(null),
          language: z.string().nullable().default(null),
        })
        .prefault({}),
      readAloud: z
        .object({
          enabled: z.boolean().default(false),
          engine: z.enum(["browser", "elevenlabs"]).default("browser"),
          voice: z.string().nullable().default(null),
          onlyWhenUnfocused: z.boolean().default(false),
          quietHours: QuietHours.nullable().default(null),
        })
        .prefault({}),
    })
    .prefault({}),
  /** Image generation for every agent (§12.5). */
  imageGeneration: z
    .object({
      /** `auto`: Codex when logged in, else the first engine with a key; `none` hides the tool. */
      engine: ImageEngineSetting.default("auto"),
      defaultSize: z.string().default("1024x1024"),
      quality: z.enum(["auto", "low", "medium", "high"]).default("auto"),
      /** Images per day across all projects (0 turns generation off). */
      dailyCap: z.int().nonnegative().default(50),
      /** Overrides by project id. */
      projects: z.record(z.string(), ImageGenerationOverride).default({}),
    })
    .prefault({}),
  notifications: z
    .object({
      toasts: z.boolean().default(true),
      browser: z.boolean().default(false),
    })
    .prefault({}),
  /** Global factory controls (§10.1). */
  factory: z
    .object({
      /** Stops every project's factory loop and all factory sessions. */
      killSwitch: z.boolean().default(false),
    })
    .prefault({}),
  /**
   * Worktree cleanup (§9). Archiving a session always removes its worktree; with `cleanup` on,
   * worktrees of sessions inactive for `afterDays` are removed too, unless the session's pull
   * request is still open or the worktree has uncommitted changes.
   */
  worktrees: z
    .object({
      cleanup: z.boolean().default(true),
      afterDays: z.int().min(1).max(365).default(7),
    })
    .prefault({}),
  /** Master switch; individual automations are still off by default (§10). */
  automations: z
    .object({
      enabled: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * Update checks and one-click self-update (§16). Settings saved before `mode` existed had
   * `check: false` to turn checks off; that reads as `mode: "off"`.
   */
  updates: z.preprocess(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !("mode" in value) &&
      (value as { check?: unknown }).check === false
        ? { mode: "off" }
        : value,
    z
      .object({
        mode: UpdateMode.default("notify"),
      })
      .prefault({}),
  ),
  /** First-run setup (§14): set once the user finishes the detection checklist. */
  setup: z
    .object({
      completed: z.boolean().default(false),
      completedAt: z.iso.datetime().nullable().default(null),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof Settings>;
/** Settings as accepted on input: any subset, defaults fill the rest. */
export type SettingsInput = z.input<typeof Settings>;

/** Recursive partial used for `PATCH /api/settings`; validated by re-parsing the merged result. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
export type SettingsPatch = DeepPartial<Settings>;

/** Default settings. */
export function defaultSettings(): Settings {
  return Settings.parse({});
}
