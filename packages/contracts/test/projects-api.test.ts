import { describe, expect, it } from "vitest";
import {
  DisconnectGithubResponse,
  EventEnvelope,
  Project,
  ProjectRefreshOutcome,
  RefreshProjectResponse,
} from "../src";
import { sampleProject, ts } from "./fixtures";

function roundTrip<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  const first = schema.parse(value);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  expect(second).toEqual(first);
  return second;
}

const local = { ...sampleProject, kind: "local" as const, github: undefined };
const detected = {
  isGitRepo: true,
  gitRoot: "C:/Projects/codeden",
  remoteUrl: "https://github.com/acme/codeden.git",
  github: {
    owner: "acme",
    repo: "codeden",
    remoteUrl: "https://github.com/acme/codeden.git",
    defaultBranch: "main",
  },
  defaultBranch: "main",
  currentBranch: "main",
  packageManager: "pnpm",
  suggestedSetupCommands: ["pnpm install"],
};

describe("project re-detection", () => {
  it("round-trips a project with a remote warning, and one without", () => {
    const warned = roundTrip(Project, {
      ...sampleProject,
      remoteWarning: { code: "github_remote_missing", remoteUrl: null, detectedAt: ts },
    });
    expect(warned.remoteWarning).toEqual({
      code: "github_remote_missing",
      remoteUrl: null,
      detectedAt: ts,
    });
    expect(roundTrip(Project, sampleProject).remoteWarning).toBeUndefined();
    expect(
      Project.safeParse({ ...sampleProject, remoteWarning: { code: "other", detectedAt: ts } })
        .success,
    ).toBe(false);
  });

  it("parses project events written before remote warnings existed", () => {
    const envelope = roundTrip(EventEnvelope, {
      type: "project.updated",
      sessionId: null,
      payload: { project: sampleProject },
      seq: 1,
      ts,
    });
    expect(envelope.type === "project.updated" && envelope.payload.project.remoteWarning).toBe(
      undefined,
    );
  });

  it("round-trips every refresh outcome", () => {
    for (const outcome of ProjectRefreshOutcome.options) {
      roundTrip(RefreshProjectResponse, {
        project: outcome === "github_connected" ? sampleProject : local,
        outcome,
        changed: outcome !== "unchanged" && outcome !== "folder_missing",
        message: "Connected to acme/codeden",
        detected: outcome === "folder_missing" ? null : detected,
      });
    }
    expect(
      RefreshProjectResponse.safeParse({
        project: local,
        outcome: "upgraded",
        changed: true,
        message: "",
        detected: null,
      }).success,
    ).toBe(false);
  });

  it("round-trips the disconnect response", () => {
    expect(roundTrip(DisconnectGithubResponse, { project: local }).project.kind).toBe("local");
  });
});
