import { copyFileSync, existsSync } from "node:fs";
import { Settings, type SettingsPatch } from "@codeden/contracts";
import { readJsonFile, writeJsonFile } from "./json-file";

/** Loads and saves `<home>/settings.json` (non-secret user settings). */
export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    this.current = this.load();
  }

  get(): Settings {
    return this.current;
  }

  /** Deep-merge a patch, validate, persist and return the new settings. Throws on invalid input. */
  update(patch: SettingsPatch): Settings {
    const merged = deepMerge(this.current, patch);
    const next = Settings.parse(merged);
    writeJsonFile(this.file, next);
    this.current = next;
    return next;
  }

  private load(): Settings {
    if (!existsSync(this.file)) {
      const defaults = Settings.parse({});
      writeJsonFile(this.file, defaults);
      return defaults;
    }
    const parsed = Settings.safeParse(readJsonFile(this.file) ?? {});
    if (parsed.success) return parsed.data;
    // Keep the broken file for the user and fall back to defaults.
    copyFileSync(this.file, `${this.file}.invalid-${Date.now()}`);
    const defaults = Settings.parse({});
    writeJsonFile(this.file, defaults);
    return defaults;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `patch` into `base`. Arrays and primitives replace; `undefined` is skipped;
 * `null` over an object removes the key (so record entries such as per-project overrides can
 * be deleted, and schema defaults refill anything required).
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch))
    return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null && isPlainObject(out[key])) {
      delete out[key];
      continue;
    }
    out[key] = deepMerge(out[key], value);
  }
  return out as T;
}
