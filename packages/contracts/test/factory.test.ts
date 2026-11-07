import { describe, expect, it } from "vitest";
import { FactoryLimits, FactoryLoopState, Project, Settings } from "../src";
import { sampleProject } from "./fixtures";

describe("autonomy modes and dark factory (§10.1)", () => {
  it("defaults projects to assisted with safe limits", () => {
    const {
      autonomyMode: _m,
      visionPath: _v,
      factoryLimits: _l,
      killSwitch: _k,
      ...rest
    } = sampleProject;
    const project = Project.parse(rest);
    expect(project.autonomyMode).toBe("assisted");
    expect(project.visionPath).toBe(".codeden/VISION.md");
    expect(project.killSwitch).toBe(false);
    expect(project.factoryLimits.allowDeploys).toBe(false);
    expect(project.factoryLimits.dailyBudget).toEqual({});
    expect(project.factoryLimits.protectedPaths).toEqual([]);
  });

  it("validates limits and loop states", () => {
    expect(FactoryLimits.safeParse({ maxConcurrentSessions: 0 }).success).toBe(false);
    expect(FactoryLimits.parse({ dailyBudget: { tokens: 1_000_000 } }).dailyBudget.tokens).toBe(
      1_000_000,
    );
    expect(FactoryLoopState.options).toContain("verifying");
    expect(Project.safeParse({ ...sampleProject, autonomyMode: "yolo" }).success).toBe(false);
  });

  it("has a global kill switch in settings, off by default", () => {
    expect(Settings.parse({}).factory.killSwitch).toBe(false);
  });
});
