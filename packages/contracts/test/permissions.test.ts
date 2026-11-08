import { describe, expect, it } from "vitest";
import { AutonomyLevel, ProviderCapabilities, SessionOptions } from "../src";

describe("permission levels (§11.2)", () => {
  it("adds read_only below the existing levels, keeping the old ones valid", () => {
    expect(AutonomyLevel.options).toEqual(["read_only", "supervised", "auto", "full"]);
    for (const level of AutonomyLevel.options) {
      expect(AutonomyLevel.parse(JSON.parse(JSON.stringify(level)))).toBe(level);
    }
    expect(AutonomyLevel.safeParse("readonly").success).toBe(false);
  });

  it("round-trips session options at read_only", () => {
    const opts = SessionOptions.parse({
      sessionId: "s1",
      role: "agent",
      cwd: "/repo",
      autonomy: "read_only",
    });
    expect(SessionOptions.parse(JSON.parse(JSON.stringify(opts)))).toEqual(opts);
  });

  it("treats the readOnly capability as optional", () => {
    const caps = {
      resume: true,
      steer: false,
      interrupt: true,
      approvals: true,
      userQuestions: false,
      subagents: false,
      rollback: false,
      fork: false,
      images: false,
      planMode: false,
      reasoningEffort: false,
      mcp: true,
      skills: false,
    };
    expect(ProviderCapabilities.parse(caps).readOnly).toBeUndefined();
    const withFlag = ProviderCapabilities.parse({ ...caps, readOnly: true });
    expect(ProviderCapabilities.parse(JSON.parse(JSON.stringify(withFlag)))).toEqual(withFlag);
  });
});
