import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeNotesDirs, claudeProjectSlug } from "../src/claude/notes-dirs";
import { ClaudePolicy } from "../src/claude/permissions";

/** A fake home with a main checkout and a worktree of it under `.codeden/wt`. */
function fixture(settings?: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "codeden-notes-"));
  const main = join(home, "Projects", "app");
  const wt = join(home, ".codeden", "wt", "app", "abcd1234");
  mkdirSync(join(main, ".git", "worktrees", "abcd1234"), { recursive: true });
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "abcd1234")}\n`);
  mkdirSync(join(home, ".claude"), { recursive: true });
  if (settings) writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(settings));
  return { home, main, wt };
}

describe("Claude's notes folders (plans and auto-memory)", () => {
  it("finds the plans folder and the main checkout's memory folder by default", () => {
    const { home, main, wt } = fixture();
    expect(claudeNotesDirs({ cwd: wt, home })).toEqual([
      join(home, ".claude", "plans"),
      join(home, ".claude", "projects", claudeProjectSlug(main), "memory"),
    ]);
  });

  it("honours the user's plansDirectory, autoMemoryDirectory and CLAUDE_CONFIG_DIR", () => {
    const { home, wt } = fixture({
      plansDirectory: "~/notes/plans",
      autoMemoryDirectory: "~/notes/memory",
    });
    expect(claudeNotesDirs({ cwd: wt, home })).toEqual([
      join(home, "notes", "plans"),
      join(home, "notes", "memory"),
    ]);
    const configDir = join(home, "claude-config");
    mkdirSync(configDir);
    expect(claudeNotesDirs({ cwd: wt, home, configDir })[0]).toBe(join(configDir, "plans"));
  });

  it("never covers Claude's config folder, the home directory or a filesystem root", () => {
    for (const plansDirectory of ["~", "~/.claude", "/", "~/.."]) {
      const { home, wt } = fixture({ plansDirectory });
      const dirs = claudeNotesDirs({ cwd: wt, home });
      expect(dirs, plansDirectory).toHaveLength(1);
      expect(dirs[0]).toContain("memory");
    }
  });

  it("ignores a repository's own settings", () => {
    const { home, wt } = fixture();
    mkdirSync(join(wt, ".claude"));
    writeFileSync(
      join(wt, ".claude", "settings.json"),
      JSON.stringify({ plansDirectory: "../../../..", autoMemoryDirectory: "~" }),
    );
    expect(claudeNotesDirs({ cwd: wt, home })[0]).toBe(join(home, ".claude", "plans"));
  });
});

describe("ClaudePolicy with notes folders", () => {
  const ctx = {
    cwd: "/home/me/.codeden/wt/app/abcd1234",
    platform: "linux" as const,
    home: "/home/me",
    tempRoots: ["/tmp"],
    notesRoots: ["/home/me/.claude/plans", "/home/me/.claude/projects/-home-me-app/memory"],
  };

  it("lets Claude write its plans and memory under Auto and Full", () => {
    for (const level of ["auto", "full"] as const) {
      const p = new ClaudePolicy(level, ctx);
      for (const file_path of [
        "/home/me/.claude/plans/peppy-conjuring-lampson.md",
        "/home/me/.claude/projects/-home-me-app/memory/MEMORY.md",
        "/home/me/.claude/projects/-home-me-app/memory/feedback-testing.md",
      ]) {
        expect(p.gate("Write", { file_path }).ask, `${level}: ${file_path}`).toBe(false);
        expect(p.gate("Edit", { file_path }).ask, `${level}: ${file_path}`).toBe(false);
      }
    }
  });

  it("still asks for Claude's settings, credentials and secrets in the notes folders", () => {
    for (const level of ["auto", "full"] as const) {
      const p = new ClaudePolicy(level, ctx);
      for (const file_path of [
        "/home/me/.claude/settings.json",
        "/home/me/.claude/.credentials.json",
        "/home/me/.claude/projects/-home-me-other/memory/MEMORY.md",
        "/home/me/.claude/plans/.env",
      ]) {
        expect(p.gate("Write", { file_path }), `${level}: ${file_path}`).toMatchObject({
          ask: true,
          action: "outside_worktree",
        });
      }
    }
    expect(
      new ClaudePolicy("supervised", ctx).gate("Write", {
        file_path: "/home/me/.claude/plans/x.md",
      }),
    ).toMatchObject({ ask: true, action: "file_change" });
  });
});
