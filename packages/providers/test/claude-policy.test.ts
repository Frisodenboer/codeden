import { describe, expect, it } from "vitest";
import { ClaudePolicy, permissionModeFor } from "../src/claude/permissions";

describe("ClaudePolicy", () => {
  const ctx = {
    cwd: "/work/repo",
    platform: "linux" as const,
    home: "/home/me",
    tempRoots: ["/tmp"],
  };

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

  it("full asks only for writes outside the worktree and temp, and for secrets", () => {
    const p = new ClaudePolicy("full", ctx);
    expect(p.gate("Bash", { command: "git push --force" }).ask).toBe(false);
    expect(p.gate("Bash", { command: "npm i -g x" }).ask).toBe(false);
    expect(p.gate("Write", { file_path: "/etc/x" })).toMatchObject({
      ask: true,
      action: "outside_worktree",
    });
    expect(p.gate("Write", { file_path: "/tmp/x/probe.ts" }).ask).toBe(false);
    expect(p.gate("Bash", { command: "pnpm build > /tmp/build.log" }).ask).toBe(false);
    expect(p.gate("Read", { file_path: ".env" })).toMatchObject({ ask: true, action: "secrets" });
    expect(p.gate("Write", { file_path: "/tmp/.env" })).toMatchObject({ action: "secrets" });
  });

  it("auto and supervised treat temp writes by their own rules", () => {
    expect(new ClaudePolicy("auto", ctx).gate("Write", { file_path: "/tmp/a.ts" }).ask).toBe(false);
    expect(
      new ClaudePolicy("supervised", ctx).gate("Write", { file_path: "/tmp/a.ts" }),
    ).toMatchObject({ ask: true, action: "file_change" });
  });

  it("switches level for the next call and keeps allow_session decisions", () => {
    const p = new ClaudePolicy("auto", ctx);
    const outside = { command: "cp build/app /usr/local/bin/app" };
    const push = { command: "git push --force" };
    expect(p.gate("Bash", push).ask).toBe(true);
    p.allowForSession("Bash", { command: "pnpm test" });

    p.setAutonomy("full");
    expect(p.level).toBe("full");
    expect(p.gate("Bash", push).ask).toBe(false);
    expect(p.needsUser("Bash", push).ask).toBe(false);
    expect(p.gate("Bash", outside)).toMatchObject({ ask: true, action: "outside_worktree" });

    p.setAutonomy("supervised");
    expect(p.gate("Bash", { command: "ls" }).ask).toBe(true);
    expect(p.gate("Bash", { command: "pnpm test" }).ask).toBe(false);

    p.setAutonomy("auto");
    expect(p.gate("Bash", { command: "ls" }).ask).toBe(false);
  });
});
