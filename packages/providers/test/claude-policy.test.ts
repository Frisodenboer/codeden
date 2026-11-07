import { describe, expect, it } from "vitest";
import { ClaudePolicy, permissionModeFor } from "../src/claude/permissions";

describe("ClaudePolicy", () => {
  const ctx = { cwd: "/work/repo", platform: "linux" as const, home: "/home/me" };

  it("maps autonomy to permission modes", () => {
    expect(permissionModeFor("supervised", false)).toBe("default");
    expect(permissionModeFor("auto", false)).toBe("acceptEdits");
    expect(permissionModeFor("full", false)).toBe("bypassPermissions");
    expect(permissionModeFor("full", true)).toBe("plan");
  });

  it("supervised asks for every edit and command", () => {
    const p = new ClaudePolicy("supervised", ctx);
    expect(p.gate("Bash", { command: "ls" })).toMatchObject({ ask: true, action: "command" });
    expect(p.gate("Edit", { file_path: "a.ts" })).toMatchObject({
      ask: true,
      action: "file_change",
    });
    expect(p.gate("Read", { file_path: "a.ts" }).ask).toBe(false);
    expect(p.needsUser("mcp__x__y", {}).ask).toBe(true);
    p.allowForSession("Bash", { command: "ls" });
    expect(p.gate("Bash", { command: "ls" }).ask).toBe(false);
    expect(p.gate("Bash", { command: "pwd" }).ask).toBe(true);
  });

  it("auto asks only for risky actions", () => {
    const p = new ClaudePolicy("auto", ctx);
    expect(p.gate("Bash", { command: "pnpm test" }).ask).toBe(false);
    expect(p.needsUser("Bash", { command: "pnpm test" }).ask).toBe(false);
    expect(p.gate("Bash", { command: "git push --force" })).toMatchObject({
      ask: true,
      action: "git_destructive",
    });
    expect(p.gate("Write", { file_path: "/etc/x" })).toMatchObject({
      ask: true,
      action: "outside_worktree",
    });
    expect(p.gate("Read", { file_path: ".env" })).toMatchObject({ ask: true, action: "secrets" });
    expect(p.gate("AskUserQuestion", {}).ask).toBe(true);
  });

  it("full asks only for writes outside the worktree", () => {
    const p = new ClaudePolicy("full", ctx);
    expect(p.gate("Bash", { command: "git push --force" }).ask).toBe(false);
    expect(p.gate("Write", { file_path: "/etc/x" })).toMatchObject({
      ask: true,
      action: "outside_worktree",
    });
  });
});
