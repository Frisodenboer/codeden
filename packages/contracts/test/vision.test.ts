import { describe, expect, it } from "vitest";
import { ParsedVision, parseProtectedAreas, parseVision } from "../src";

describe("vision parsing (§10.1)", () => {
  it("reads sections and splits protected areas into globs and topics", () => {
    const parsed = parseVision(
      [
        "# Vision",
        "## Goals",
        "- Fast checkout",
        "## Target users",
        "- Small shops",
        "## Protected areas",
        "- `**/auth/**`",
        "- payments",
        "- LICENSE",
        "## Something else",
        "- ignored",
      ].join("\n"),
    );
    expect(ParsedVision.parse(parsed)).toEqual(parsed);
    expect(parsed.goals).toEqual(["Fast checkout"]);
    expect(parsed.users).toEqual(["Small shops"]);
    expect(parsed.protectedAreas.topics).toEqual(["payments"]);
    expect(parsed.protectedAreas.globs).toContain("**/auth/**");
    expect(parsed.protectedAreas.globs).toContain("**/billing/**");
    expect(parsed.protectedAreas.globs).toContain("LICENSE");
  });

  it("treats path-like bullets as globs", () => {
    expect(parseProtectedAreas(["src/secrets/* — keys", "Data migrations"])).toEqual({
      globs: ["src/secrets/*", "**/migrations/**", "**/*migration*.*"],
      topics: ["data migrations"],
    });
  });
});
