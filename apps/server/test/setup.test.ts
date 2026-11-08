import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../src/services/exec";
import {
  expiresWithin,
  parseClaudeAuth,
  parseCodexLogin,
  parseGhAuthJson,
  parseGhAuthText,
  parseVersion,
} from "../src/services/setup/parse";
import { SetupService } from "../src/services/setup/setup-service";
import { SettingsStore } from "../src/settings-store";

const NOW = Date.parse("2026-11-07T10:00:00.000Z");

describe("detection parsers", () => {
  it("reads versions", () => {
    expect(parseVersion("2.1.318 (Claude Code)")).toBe("2.1.318");
    expect(parseVersion("codex-cli 0.160.1")).toBe("0.160.1");
    expect(parseVersion("gh version 2.81.0 (2025-10-01)")).toBe("2.81.0");
    expect(parseVersion("nothing")).toBeNull();
  });

  it("reads claude auth status JSON", () => {
    const auth = parseClaudeAuth(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        loginExpiresAt: "2026-11-09T00:00:00Z",
        email: "a@b.c",
      }),
    );
    expect(auth).toEqual({
      loggedIn: true,
      authMethod: "claude.ai",
      account: "a@b.c",
      loginExpiresAt: "2026-11-09T00:00:00.000Z",
    });
    expect(parseClaudeAuth("not json")).toBeNull();
    expect(expiresWithin(auth?.loginExpiresAt ?? null, 3, NOW)).toBe(true);
    expect(expiresWithin("2026-12-01T00:00:00Z", 3, NOW)).toBe(false);
  });

  it("reads codex and gh login state without capturing tokens", () => {
    expect(parseCodexLogin(0, "Logged in using ChatGPT")).toEqual({
      loggedIn: true,
      authMethod: "ChatGPT",
    });
    expect(parseCodexLogin(1, "Not logged in")).toEqual({ loggedIn: false, authMethod: null });
    expect(
      parseGhAuthJson(
        '{"hosts":{"github.com":[{"state":"success","active":true,"login":"octo","tokenSource":"keyring"}]}}',
      ),
    ).toEqual({ loggedIn: true, account: "octo" });
    const text =
      "github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Token: gho_****";
    const parsed = parseGhAuthText(0, text);
    expect(parsed).toEqual({ loggedIn: true, account: "octo" });
    expect(JSON.stringify(parsed)).not.toContain("gho_");
  });
});

/** Fake CLIs: a map from "command args" to a result. */
function fakeExec(table: Record<string, Partial<ExecResult>>, calls: string[] = []): Exec {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    calls.push(key);
    const hit = table[key];
    if (!hit)
      return { code: null, stdout: "", stderr: "", notFound: true, timedOut: false, path: null };
    return {
      code: 0,
      stdout: "",
      stderr: "",
      notFound: false,
      timedOut: false,
      path: `/bin/${command}`,
      ...hit,
    };
  };
}

let dir: string;
let settings: SettingsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-setup-"));
  settings = new SettingsStore(join(dir, "settings.json"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const happy: Record<string, Partial<ExecResult>> = {
  "claude --version": { stdout: "2.1.318 (Claude Code)" },
  "claude auth status": {
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      loginExpiresAt: "2026-11-08T00:00:00Z",
    }),
  },
  "codex --version": { stdout: "codex-cli 0.160.1" },
  "codex login status": { code: 1, stdout: "Not logged in" },
  "git --version": { stdout: "git version 2.50.1" },
  "git config --get user.name": { stdout: "Ada" },
  "git config --get user.email": { stdout: "ada@example.com" },
};

describe("SetupService", () => {
  it("runs every check, flags an expiring Claude login and reports readiness", async () => {
    const service = new SetupService({
      exec: fakeExec(happy),
      settings,
      platform: "linux",
      nodeVersion: "v24.16.0",
      now: () => NOW,
      browserProbe: { exists: () => false },
    });
    const status = await service.status();
    const by = Object.fromEntries(status.checks.map((c) => [c.id, c]));
    expect(by.claude).toMatchObject({ state: "warning", loggedIn: true, version: "2.1.318" });
    expect(by.claude?.fix?.command).toBe("claude auth login");
    expect(by.codex).toMatchObject({ state: "missing", installed: true, loggedIn: false });
    expect(by.gh).toMatchObject({ state: "missing", installed: false });
    expect(by.git).toMatchObject({ state: "ok", account: "Ada <ada@example.com>" });
    expect(by.node).toMatchObject({ state: "ok", version: "24.16.0" });
    expect(by.browser?.state).toBe("warning");
    expect(status.ready).toBe(true);
    expect(status.warnings.map((w) => w.id)).toContain("claude");
    expect(status.setupCompleted).toBe(false);
  });

  it("caches results and re-checks on refresh", async () => {
    const calls: string[] = [];
    const service = new SetupService({ exec: fakeExec(happy, calls), settings, platform: "linux" });
    await service.status();
    const first = calls.length;
    await service.status();
    expect(calls.length).toBe(first);
    await service.status({ refresh: true });
    expect(calls.length).toBe(first * 2);
  });

  it("reports every completed check, but not cached results", async () => {
    const checked: string[] = [];
    const service = new SetupService({
      exec: fakeExec(happy),
      settings,
      platform: "linux",
      onChecked: (status) => {
        checked.push(status.checkedAt);
        throw new Error("a failing listener does not fail the check");
      },
    });
    await service.status();
    await service.status();
    expect(checked).toHaveLength(1);
    await expect(service.status({ refresh: true })).resolves.toMatchObject({ ready: true });
    expect(checked).toHaveLength(2);
  });

  it("times out slow checks instead of hanging", async () => {
    const slow: Exec = (command, args) =>
      command === "claude" ? new Promise(() => {}) : fakeExec(happy)(command, args);
    const service = new SetupService({
      exec: slow,
      settings,
      platform: "linux",
      checkTimeoutMs: 50,
    });
    const status = await service.status();
    expect(status.checks.find((c) => c.id === "claude")).toMatchObject({ state: "error" });
    expect(status.ready).toBe(false);
  });

  it("persists completion in settings and hands out login commands", () => {
    const service = new SetupService({ exec: fakeExec({}), settings });
    service.complete();
    expect(new SettingsStore(join(dir, "settings.json")).get().setup.completed).toBe(true);
    expect(service.loginCommand("gh")).toMatchObject({
      command: "gh auth login --web --git-protocol https",
    });
  });
});
