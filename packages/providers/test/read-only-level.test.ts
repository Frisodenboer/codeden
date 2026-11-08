import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, SessionOptions } from "@codeden/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudePolicy, permissionModeFor } from "../src/claude/permissions";
import {
  codexConfigOverrides,
  codexPolicy,
  codexSandboxPolicy,
  codexWritableRoots,
} from "../src/codex/config";
import { CodexSession } from "../src/codex/session";
import { FakeProvider } from "../src/fake/adapter";
import type { FakeSession } from "../src/fake/session";
import { readOnlyCommandDenial } from "../src/policy/read-only";

const agent: SessionOptions = {
  sessionId: "a1",
  role: "agent",
  cwd: tmpdir(),
  autonomy: "read_only",
  mcpServers: [],
  additionalDirectories: [],
  planMode: false,
};

const ctx = { cwd: "/repo", extraRoots: [] };

describe("the read_only permission level: checks (§11.2)", () => {
  it("lets agent sessions run checks without writing flags", () => {
    for (const ok of [
      "pnpm test",
      "pnpm run lint",
      "npm test -- --run",
      "yarn typecheck",
      "npx tsc --noEmit",
      "cargo test",
      "go vet ./...",
      "python -m pytest -q",
      "biome check .",
      "ruff check src",
      "pnpm test 2>&1 | tail -20",
    ]) {
      expect(readOnlyCommandDenial(ok, { allowChecks: true }), ok).toBeUndefined();
    }
    for (const bad of [
      "pnpm install",
      "pnpm run build",
      "npm run deploy",
      "biome check --write .",
      "eslint --fix src",
      "vitest -u",
      "jest --updateSnapshot",
      "ruff format",
      "cargo run",
      "pnpm test > out.txt",
      "git commit -am wip",
      "git push origin HEAD",
    ]) {
      expect(readOnlyCommandDenial(bad, { allowChecks: true }), bad).toBeTruthy();
    }
  });

  it("keeps checks off for the orchestrator and PMs", () => {
    expect(readOnlyCommandDenial("pnpm test")).toBeTruthy();
    expect(readOnlyCommandDenial("pnpm test", { allowChecks: false })).toBeTruthy();
  });
});

describe("the read_only permission level on Claude (stubbed, §11.2)", () => {
  it("uses the default permission mode, so nothing runs without CodeDen's policy", () => {
    expect(permissionModeFor("read_only", false)).toBe("default");
    expect(permissionModeFor("read_only", true)).toBe("plan");
  });

  it("denies edits, commits and pushes, and allows reads and checks", () => {
    const policy = new ClaudePolicy("read_only", ctx);
    expect(policy.isReadOnly).toBe(true);
    expect(policy.denial("Edit", { file_path: "/repo/a.ts" })).toMatch(/read-only permissions/);
    expect(policy.denial("Write", { file_path: "/repo/b.ts" })).toBeTruthy();
    expect(policy.denial("NotebookEdit", { notebook_path: "/repo/n.ipynb" })).toBeTruthy();
    expect(policy.denial("Bash", { command: "git commit -m x" })).toMatch(/read-only/);
    expect(policy.denial("Bash", { command: "git push" })).toMatch(/read-only/);
    expect(policy.denial("PowerShell", { command: "Remove-Item a.txt" })).toBeTruthy();
    expect(policy.denial("Bash", { command: "git diff HEAD~1" })).toBeUndefined();
    expect(policy.denial("Bash", { command: "pnpm test" })).toBeUndefined();
    expect(policy.denial("Read", { file_path: "/repo/a.ts" })).toBeUndefined();
    expect(policy.gate("Read", { file_path: "/repo/a.ts" })).toEqual({ ask: false });
  });

  it("switches into and out of read_only live", () => {
    const policy = new ClaudePolicy("auto", ctx);
    expect(policy.denial("Edit", { file_path: "/repo/a.ts" })).toBeUndefined();
    policy.setAutonomy("read_only");
    expect(policy.denial("Edit", { file_path: "/repo/a.ts" })).toBeTruthy();
    policy.setAutonomy("full");
    expect(policy.denial("Edit", { file_path: "/repo/a.ts" })).toBeUndefined();
  });

  it("keeps a read-only role read-only on every level, without checks", () => {
    const pm = new ClaudePolicy("full", ctx, true);
    expect(pm.isReadOnly).toBe(true);
    expect(pm.denial("Bash", { command: "pnpm test" })).toBeTruthy();
  });
});

describe("the read_only permission level on Codex (stubbed, §11.2)", () => {
  it("maps to the read-only sandbox with no approvals and no network", () => {
    expect(codexPolicy("read_only")).toEqual({
      approvalPolicy: "never",
      sandbox: "read-only",
      networkAccess: false,
    });
    expect(codexSandboxPolicy(agent, ["/tmp"])).toEqual({ type: "readOnly", networkAccess: false });
    expect(codexWritableRoots(agent, ["/tmp"])).toEqual([]);
    expect(codexConfigOverrides(agent, ["/tmp"])).toEqual({
      "sandbox_workspace_write.network_access": false,
    });
  });

  it("starts a thread in the read-only sandbox and switches on the next turn", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "codeden-codex-readonly-")), "requests.log");
    process.env.FAKE_CODEX_LOG = log;
    const session = new CodexSession(agent, {
      executable: {
        kind: "node-script",
        path: process.execPath,
        script: join(import.meta.dirname, "fixtures", "fake-codex", "app-server.mjs"),
      },
    });
    sessions.push(session);
    let completed = 0;
    void (async () => {
      for await (const e of session.events as AsyncIterable<AgentEvent>) {
        if (e.type === "turn.completed") completed++;
      }
    })();
    const turn = async (text: string) => {
      const target = completed + 1;
      await session.send({ text, attachments: [] });
      const deadline = Date.now() + 5000;
      while (completed < target) {
        if (Date.now() > deadline) throw new Error(`turn "${text}" did not complete`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await session.start();
    const logged = () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as { method: string; params: Record<string, unknown> })
        : [];
    expect(logged().find((r) => r.method === "thread/start")?.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    await turn("look around");
    await session.setAutonomy("auto");
    await turn("now fix it");
    const turns = logged().filter((r) => r.method === "turn/start");
    expect(turns[1]?.params).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });
});

const sessions: CodexSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  delete process.env.FAKE_CODEX_LOG;
});

describe("the read_only permission level on the Fake provider", () => {
  it("never runs the scripted command or asks for approval", async () => {
    const session = (await new FakeProvider().openSession(agent)) as FakeSession;
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const e of session.events) events.push(e);
    })();
    await session.send({ text: "go [approval]", attachments: [] });
    const deadline = Date.now() + 5000;
    while (!events.some((e) => e.type === "turn.completed")) {
      if (Date.now() > deadline) throw new Error("turn did not complete");
      await new Promise((r) => setTimeout(r, 10));
    }
    const kinds = events.flatMap((e) => (e.type === "item.started" ? [e.item.kind] : []));
    expect(kinds).not.toContain("approval_request");
    expect(kinds).not.toContain("command");
    await session.close();
  });
});
