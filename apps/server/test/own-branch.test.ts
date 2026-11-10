import { describe, expect, it } from "vitest";
import { ownBranch } from "../src/services/sessions/own-branch";
import { sampleSession } from "./helpers";

describe("the branch a session owns (§11.2)", () => {
  const worktree = {
    ...sampleSession,
    worktreePath: "/home/me/.codeden/wt/app/abcd1234",
    branch: "codeden/fix-login-ab12",
    baseBranch: "main",
  };

  it("is the branch of the session's own worktree", () => {
    expect(ownBranch(worktree)).toBe("codeden/fix-login-ab12");
    expect(ownBranch({ ...worktree, branch: "feature/review-fixes" })).toBe("feature/review-fixes");
  });

  it("is never a shared folder's branch, the base branch or a default branch", () => {
    expect(ownBranch({ ...worktree, worktreePath: null })).toBeUndefined();
    expect(ownBranch({ ...worktree, branch: null })).toBeUndefined();
    expect(ownBranch({ ...worktree, branch: "release", baseBranch: "release" })).toBeUndefined();
    for (const branch of ["main", "master", "develop", "trunk"]) {
      expect(ownBranch({ ...worktree, branch, baseBranch: null }), branch).toBeUndefined();
    }
  });
});
