import { describe, expect, it } from "vitest";
import { CustomModel, defaultSettings, ModelRef, Settings } from "../src";

describe("Settings.models", () => {
  it("defaults to no favourites or hidden models, so older settings files still parse", () => {
    expect(defaultSettings().models).toEqual({ favorites: [], hidden: {}, custom: {} });
    const older = { providers: { agent: { provider: "codex", model: "default" } } };
    expect(Settings.parse(older).models).toEqual({ favorites: [], hidden: {}, custom: {} });
    // Saved with favourites only, before hidden models existed.
    const withFavorites = { models: { favorites: [{ provider: "claude", model: "opus" }] } };
    expect(Settings.parse(withFavorites).models.hidden).toEqual({});
    // Saved before custom models existed.
    const withHidden = { models: { favorites: [], hidden: { codex: ["gpt-5.5-terra"] } } };
    expect(Settings.parse(withHidden).models.custom).toEqual({});
  });

  it("round-trips custom model ids by provider, with optional labels", () => {
    const custom = {
      claude: [{ id: "claude-opus-6-preview", label: "Opus 6 preview" }, { id: "my-proxy-model" }],
      codex: [],
    };
    const parsed = Settings.parse({ models: { custom } });
    expect(parsed.models.custom).toEqual(custom);
    expect(Settings.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    // Ids and labels are trimmed.
    expect(CustomModel.parse({ id: "  x-1 ", label: " X " })).toEqual({ id: "x-1", label: "X" });
  });

  it("rejects empty, duplicate and malformed custom models", () => {
    expect(CustomModel.safeParse({ id: "   " }).success).toBe(false);
    expect(CustomModel.safeParse({ id: "x", label: "" }).success).toBe(false);
    expect(() =>
      Settings.parse({ models: { custom: { codex: [{ id: "a" }, { id: "a" }] } } }),
    ).toThrow(/unique/);
    expect(() =>
      Settings.parse({ models: { custom: { "Not A Provider": [{ id: "x" }] } } }),
    ).toThrow();
  });

  it("round-trips favourites as provider and model pairs, in order", () => {
    const favorites = [
      { provider: "codex", model: "gpt-6.1-sol" },
      { provider: "claude", model: "opus" },
    ];
    const parsed = Settings.parse({ models: { favorites } });
    expect(parsed.models.favorites).toEqual(favorites);
    expect(Settings.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("round-trips hidden model ids by provider", () => {
    const hidden = { codex: ["gpt-5.5-terra", "gpt-5.6-luna-mini"], claude: [] };
    const parsed = Settings.parse({ models: { hidden } });
    expect(parsed.models.hidden).toEqual(hidden);
    expect(Settings.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects malformed entries", () => {
    expect(ModelRef.safeParse({ provider: "codex", model: "" }).success).toBe(false);
    expect(ModelRef.safeParse({ provider: "Not A Provider", model: "x" }).success).toBe(false);
    expect(() => Settings.parse({ models: { favorites: [{ model: "opus" }] } })).toThrow();
    expect(() => Settings.parse({ models: { hidden: { codex: [""] } } })).toThrow();
    expect(() => Settings.parse({ models: { hidden: { "Not A Provider": ["x"] } } })).toThrow();
  });
});
