import type { WorkSummary } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import {
  derivePurpose,
  deriveWorkKey,
  findConflicts,
  pathsOverlap,
  scopesOverlap,
} from "../src/services/sessions/conflicts";

const work = (over: Partial<WorkSummary>): WorkSummary => ({
  kind: "session",
  id: "w1",
  sessionId: "w1",
  projectId: "p1",
  startedBy: { kind: "user" },
  purpose: "x",
  workKey: "issue:1",
  scope: { projectId: "p1" },
  progress: null,
  status: "running",
  startedAt: "2026-11-07T10:00:00.000Z",
  ...over,
});

describe("conflict detection (§8.4)", () => {
  it("matches the same work key in the same project only", () => {
    const existing = [work({}), work({ id: "w2", projectId: "p2", scope: { projectId: "p2" } })];
    const found = findConflicts({ workKey: "issue:1", scope: { projectId: "p1" } }, existing);
    expect(found.map((w) => w.id)).toEqual(["w1"]);
    expect(findConflicts({ workKey: "issue:2", scope: { projectId: "p1" } }, existing)).toEqual([]);
  });

  it("matches overlapping scopes for the same kind of work", () => {
    const existing = [
      work({ workKey: "automation:security-audit", scope: { projectId: "p1", area: "Auth" } }),
      work({
        id: "w2",
        workKey: "request:refactor",
        scope: { projectId: "p1", paths: ["src/auth"] },
      }),
    ];
    const byArea = findConflicts(
      { workKey: "automation:dependency-sweep", scope: { projectId: "p1", area: "auth" } },
      existing,
    );
    expect(byArea.map((w) => w.id)).toEqual(["w1"]);
    const byPath = findConflicts(
      { workKey: "request:fix-login", scope: { projectId: "p1", paths: ["src/auth/login.ts"] } },
      existing,
    );
    expect(byPath.map((w) => w.id)).toEqual(["w2"]);
    // Different kind of work: overlapping scope alone is not a conflict.
    const otherKind = findConflicts(
      { workKey: "issue:9", scope: { projectId: "p1", paths: ["src/auth"] } },
      existing,
    );
    expect(otherKind).toEqual([]);
  });

  it("never treats whole-project scopes as overlapping", () => {
    expect(scopesOverlap({ projectId: "p1" }, { projectId: "p1" })).toBe(false);
    expect(
      scopesOverlap({ projectId: "p1", paths: ["a"] }, { projectId: "p2", paths: ["a"] }),
    ).toBe(false);
  });

  it("compares paths by containment, ignoring separators and case", () => {
    expect(pathsOverlap("src\\Auth\\", "src/auth/login.ts")).toBe(true);
    expect(pathsOverlap("./src/a", "src/ab")).toBe(false);
    expect(pathsOverlap("src", "src")).toBe(true);
  });

  it("derives work keys and purposes", () => {
    expect(deriveWorkKey({ workKey: "pr:5", purpose: "x" })).toBe("pr:5");
    expect(deriveWorkKey({ issueNumber: 42, purpose: "x" })).toBe("issue:42");
    expect(deriveWorkKey({ purpose: "Fix the Login bug!" })).toBe("request:fix-the-login-bug");
    expect(derivePurpose(undefined, "\n  Add dark mode\nmore")).toBe("Add dark mode");
    expect(derivePurpose(undefined, undefined)).toBe("New session");
    expect(derivePurpose("Given", "ignored")).toBe("Given");
  });
});
