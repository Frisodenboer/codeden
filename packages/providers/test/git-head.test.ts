import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/policy/risk";
import { currentGitBranch } from "../src/util/git-head";

describe("currentGitBranch", () => {
  it("reads HEAD of a checkout and of a worktree, without running git", () => {
    const root = mkdtempSync(join(tmpdir(), "codeden-head-"));
    const main = join(root, "main");
    const wt = join(root, "wt");
    const admin = join(main, ".git", "worktrees", "wt");
    mkdirSync(admin, { recursive: true });
    mkdirSync(wt);
    writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/codeden/fix-ab12\n");
    writeFileSync(join(wt, ".git"), `gitdir: ${admin}\n`);
    expect(currentGitBranch(main)).toBe("main");
    expect(currentGitBranch(wt)).toBe("codeden/fix-ab12");

    // The classifier reads it when the session has a branch of its own.
    const ctx = { cwd: wt, ownBranch: "codeden/fix-ab12" };
    expect(classifyCommand("git push --force-with-lease", ctx)).toEqual({ risky: false });
    expect(
      classifyCommand("git push --force-with-lease", { cwd: main, ownBranch: "x" }),
    ).toMatchObject({ risky: true, action: "git_destructive" });

    writeFileSync(join(admin, "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(currentGitBranch(wt)).toBeUndefined();
    expect(currentGitBranch(join(root, "missing"))).toBeUndefined();
  });
});
