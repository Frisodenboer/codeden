import { describe, expect, it } from "vitest";
import { defaultSettings, ModelRef, Settings } from "../src";

describe("Settings.models", () => {
  it("defaults to no favourites, so settings saved before the field still parse", () => {
    expect(defaultSettings().models).toEqual({ favorites: [] });
    const older = { providers: { agent: { provider: "codex", model: "default" } } };
    expect(Settings.parse(older).models.favorites).toEqual([]);
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

  it("rejects malformed entries", () => {
    expect(ModelRef.safeParse({ provider: "codex", model: "" }).success).toBe(false);
    expect(ModelRef.safeParse({ provider: "Not A Provider", model: "x" }).success).toBe(false);
    expect(() => Settings.parse({ models: { favorites: [{ model: "opus" }] } })).toThrow();
  });
});
