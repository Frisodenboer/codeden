import { describe, expect, it } from "vitest";
import { ImageEnginesResponse, ImageTestRequest, Settings } from "../src";

describe("image generation contracts", () => {
  it("round-trips the settings screen shapes", () => {
    const engines = {
      engines: [
        {
          id: "codex",
          label: "Codex",
          available: true,
          requiresApiKey: false,
          referenceImages: true,
          exactSize: false,
          defaultModel: "",
        },
      ],
      active: { engine: "codex" },
      usage: { date: "2026-11-07", total: 3, byProject: { p1: 2 } },
      dailyCap: 50,
    } as const;
    expect(ImageEnginesResponse.parse(JSON.parse(JSON.stringify(engines)))).toEqual(engines);
    expect(ImageTestRequest.parse({ engine: "gemini", generate: false })).toEqual({
      engine: "gemini",
      generate: false,
    });
  });

  it("defaults per-project overrides to none and validates them", () => {
    expect(Settings.parse({}).imageGeneration.projects).toEqual({});
    const s = Settings.parse({
      imageGeneration: { projects: { p1: { engine: "openai", dailyCap: 5 } } },
    });
    expect(s.imageGeneration.projects.p1).toEqual({ engine: "openai", dailyCap: 5 });
    expect(
      Settings.safeParse({ imageGeneration: { projects: { p1: { dailyCap: -1 } } } }).success,
    ).toBe(false);
  });
});
