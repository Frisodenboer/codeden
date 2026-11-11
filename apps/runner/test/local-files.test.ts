import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyLocalFiles } from "../src/workspace/local-files";

let repo: string;
let wt: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "codebench-repo-"));
  wt = mkdtempSync(join(tmpdir(), "codebench-wt-"));
  mkdirSync(join(repo, ".claude"));
  writeFileSync(
    join(repo, ".claude", "settings.local.json"),
    '{"env":{"ANTHROPIC_AUTH_TOKEN":"x"}}',
  );
  writeFileSync(join(repo, ".env"), "A=1");
  writeFileSync(join(repo, ".env.local"), "B=2");
  writeFileSync(join(repo, ".env.example"), "A=");
  writeFileSync(join(repo, ".claude", "settings.json"), "{}");
  writeFileSync(join(repo, "README.md"), "hi");
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

describe("copy local config into a new worktree", () => {
  it("copies the Claude local settings and .env files, not templates or other files", () => {
    expect(copyLocalFiles(repo, wt).sort()).toEqual([
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".env",
      ".env.local",
    ]);
    expect(readFileSync(join(wt, ".claude", "settings.local.json"), "utf8")).toContain(
      "AUTH_TOKEN",
    );
    expect(readdirSync(wt).sort()).toEqual([".claude", ".env", ".env.local"]);
  });

  it("never overwrites a file the worktree already has", () => {
    writeFileSync(join(wt, ".env"), "TRACKED=1");
    expect(copyLocalFiles(repo, wt)).not.toContain(".env");
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("TRACKED=1");
  });
});

describe("committed Claude settings", () => {
  it("keeps the checked-out settings.json and only adds the local override", () => {
    mkdirSync(join(wt, ".claude"));
    writeFileSync(join(wt, ".claude", "settings.json"), '{"committed":true}');
    expect(copyLocalFiles(repo, wt)).not.toContain(".claude/settings.json");
    expect(readFileSync(join(wt, ".claude", "settings.json"), "utf8")).toBe('{"committed":true}');
  });
});
