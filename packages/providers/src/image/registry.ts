import type { Settings } from "@codeden/contracts";
import { CodexImageEngine, type CodexImageEngineOptions } from "./codex";
import { GeminiImageEngine, type GeminiImageEngineOptions } from "./gemini";
import { OpenAIImageEngine, type OpenAIImageEngineOptions } from "./openai";
import type { ImageEngine, ImageEngineAvailability, ImageEngineId } from "./types";

export type ImageEngineChoice = Settings["imageGeneration"]["engine"];

export type ImageEnginePick =
  | { engine: ImageEngine; availability: ImageEngineAvailability }
  | { engine: null; reason: string };

/**
 * Pure selection rule (§12.5): `none` hides the tool; an explicit engine is used only when
 * available (never silently swapped); `auto` prefers an engine that needs no API key (Codex
 * when logged in), then the first configured key engine in registration order.
 */
export function chooseImageEngine(
  choice: ImageEngineChoice,
  engines: readonly ImageEngine[],
  availability: ReadonlyMap<ImageEngineId, ImageEngineAvailability>,
): ImageEnginePick {
  if (choice === "none")
    return { engine: null, reason: "Image generation is turned off in Settings." };
  const ready = (engine: ImageEngine) => availability.get(engine.id)?.available === true;
  if (choice !== "auto") {
    const engine = engines.find((e) => e.id === choice);
    if (!engine) return { engine: null, reason: `The ${choice} image engine is not registered.` };
    const status = availability.get(engine.id);
    if (!status?.available) {
      return {
        engine: null,
        reason: status?.reason ?? `The ${engine.label} image engine is unavailable.`,
      };
    }
    return { engine, availability: status };
  }
  const ordered = [
    ...engines.filter((e) => !e.capabilities.requiresApiKey),
    ...engines.filter((e) => e.capabilities.requiresApiKey),
  ];
  const engine = ordered.find(ready);
  if (engine)
    return { engine, availability: availability.get(engine.id) as ImageEngineAvailability };
  const reasons = engines
    .map((e) => `${e.label}: ${availability.get(e.id)?.reason ?? "unavailable"}`)
    .join(" ");
  return { engine: null, reason: `No image engine is available. ${reasons}`.trim() };
}

/** The image engines CodeDen knows about, in preference order. */
export class ImageEngineRegistry {
  private readonly engines: ImageEngine[];

  constructor(engines: readonly ImageEngine[]) {
    const ids = new Set<string>();
    for (const engine of engines) {
      if (ids.has(engine.id)) throw new Error(`Duplicate image engine: ${engine.id}`);
      ids.add(engine.id);
    }
    this.engines = [...engines];
  }

  list(): readonly ImageEngine[] {
    return this.engines;
  }

  get(id: ImageEngineId): ImageEngine | undefined {
    return this.engines.find((e) => e.id === id);
  }

  /** Detect every engine in parallel (each `detect()` never throws). */
  async detectAll(): Promise<Map<ImageEngineId, ImageEngineAvailability>> {
    const results = await Promise.all(
      this.engines.map(async (e) => [e.id, await e.detect()] as const),
    );
    return new Map(results);
  }

  /** The engine `generate_image` should use for these settings, or why there is none. */
  async pickDefault(
    settings: Pick<Settings["imageGeneration"], "engine">,
  ): Promise<ImageEnginePick> {
    if (settings.engine === "none") return chooseImageEngine("none", this.engines, new Map());
    const subset =
      settings.engine === "auto"
        ? this.engines
        : this.engines.filter((e) => e.id === settings.engine);
    const availability = new Map(
      await Promise.all(subset.map(async (e) => [e.id, await e.detect()] as const)),
    );
    return chooseImageEngine(settings.engine, this.engines, availability);
  }
}

export interface DefaultImageEnginesOptions {
  codex?: CodexImageEngineOptions;
  gemini?: GeminiImageEngineOptions;
  openai?: OpenAIImageEngineOptions;
}

/** Codex, Gemini and OpenAI Images, in that order. API keys are read through the options. */
export function createImageEngineRegistry(
  opts: DefaultImageEnginesOptions = {},
): ImageEngineRegistry {
  return new ImageEngineRegistry([
    new CodexImageEngine(opts.codex),
    new GeminiImageEngine(opts.gemini),
    new OpenAIImageEngine(opts.openai),
  ]);
}
