import { describe, expect, it } from "vitest";
import {
  chooseImageEngine,
  createImageEngineRegistry,
  ImageEngineRegistry,
} from "../../src/image/registry";
import type { ImageEngine, ImageEngineAvailability, ImageEngineId } from "../../src/image/types";

function engine(id: ImageEngineId, available: boolean, requiresApiKey = id !== "codex") {
  let detects = 0;
  const e: ImageEngine & { detects: () => number } = {
    id,
    label: id,
    defaultModel: "",
    capabilities: { referenceImages: true, exactSize: false, requiresApiKey },
    detect: async () => {
      detects++;
      return available ? { available } : { available, reason: `${id} off` };
    },
    generate: async () => ({ files: [], engine: id, model: "" }),
    detects: () => detects,
  };
  return e;
}

const avail = (entries: [ImageEngineId, boolean][]) =>
  new Map<ImageEngineId, ImageEngineAvailability>(entries.map(([id, a]) => [id, { available: a }]));

describe("chooseImageEngine", () => {
  const engines = [engine("codex", true), engine("gemini", true), engine("openai", true)];

  it("auto prefers Codex, then the first key engine", () => {
    const all = avail([
      ["codex", true],
      ["gemini", true],
      ["openai", true],
    ]);
    expect(chooseImageEngine("auto", engines, all)).toMatchObject({ engine: { id: "codex" } });
    const noCodex = avail([
      ["codex", false],
      ["gemini", false],
      ["openai", true],
    ]);
    expect(chooseImageEngine("auto", engines, noCodex)).toMatchObject({ engine: { id: "openai" } });
    // A keyless engine registered later still wins over key engines.
    const reordered = [engine("gemini", true), engine("codex", true)];
    expect(
      chooseImageEngine(
        "auto",
        reordered,
        avail([
          ["gemini", true],
          ["codex", true],
        ]),
      ),
    ).toMatchObject({ engine: { id: "codex" } });
  });

  it("explicit choices are never swapped for another engine", () => {
    const res = chooseImageEngine(
      "gemini",
      engines,
      avail([
        ["gemini", false],
        ["codex", true],
      ]),
    );
    expect(res).toMatchObject({ engine: null });
    expect(chooseImageEngine("openai", engines, avail([["openai", true]]))).toMatchObject({
      engine: { id: "openai" },
    });
  });

  it("none and nothing available hide the tool with a reason", () => {
    expect(chooseImageEngine("none", engines, new Map())).toMatchObject({
      engine: null,
      reason: expect.stringContaining("turned off"),
    });
    const res = chooseImageEngine("auto", engines, new Map());
    expect(res.engine).toBeNull();
    if (!res.engine) expect(res.reason).toMatch(/No image engine is available/);
  });
});

describe("ImageEngineRegistry", () => {
  it("only detects the engines it needs", async () => {
    const codex = engine("codex", false);
    const gemini = engine("gemini", true);
    const openai = engine("openai", true);
    const registry = new ImageEngineRegistry([codex, gemini, openai]);
    expect((await registry.pickDefault({ engine: "auto" })).engine?.id).toBe("gemini");
    expect(codex.detects() + gemini.detects() + openai.detects()).toBe(3);
    expect((await registry.pickDefault({ engine: "openai" })).engine?.id).toBe("openai");
    expect(codex.detects()).toBe(1);
    expect((await registry.pickDefault({ engine: "none" })).engine).toBeNull();
    expect(codex.detects()).toBe(1);
    expect([...(await registry.detectAll()).keys()]).toEqual(["codex", "gemini", "openai"]);
    expect(registry.get("gemini")).toBe(gemini);
  });

  it("rejects duplicates and builds the default set", () => {
    expect(() => new ImageEngineRegistry([engine("codex", true), engine("codex", true)])).toThrow(
      /Duplicate/,
    );
    expect(
      createImageEngineRegistry()
        .list()
        .map((e) => e.id),
    ).toEqual(["codex", "gemini", "openai"]);
  });
});
