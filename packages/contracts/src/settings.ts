import { z } from "zod";
import { AutonomyLevel, ProviderId, QuietHours, ReasoningEffort } from "./common";

/** `auto` lets CodeDen pick the first ready provider (Claude, then Codex). */
export const ProviderChoice = z.union([z.literal("auto"), ProviderId]);
export type ProviderChoice = z.infer<typeof ProviderChoice>;

/** Default provider/model/effort for one role. */
export const RoleDefaults = z.object({
  provider: ProviderChoice.default("auto"),
  model: z.string().nullable().default(null),
  effort: ReasoningEffort.nullable().default(null),
});
export type RoleDefaults = z.infer<typeof RoleDefaults>;

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
      engine: z.enum(["auto", "codex", "gemini", "openai", "none"]).default("auto"),
      defaultSize: z.string().default("1024x1024"),
      quality: z.enum(["auto", "low", "medium", "high"]).default("auto"),
      dailyCap: z.int().nonnegative().default(50),
    })
    .prefault({}),
  notifications: z
    .object({
      toasts: z.boolean().default(true),
      browser: z.boolean().default(false),
    })
    .prefault({}),
  /** Master switch; individual automations are still off by default (§10). */
  automations: z
    .object({
      enabled: z.boolean().default(true),
    })
    .prefault({}),
  updates: z
    .object({
      check: z.boolean().default(true),
    })
    .prefault({}),
  telemetry: z
    .object({
      crashReports: z.boolean().default(false),
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
