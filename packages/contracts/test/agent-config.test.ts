import { describe, expect, it } from "vitest";
import {
  AgentConfigFile,
  AgentConfigLocator,
  LoadedAgentConfig,
  McpServerSpec,
  McpServerUpsertRequest,
} from "../src";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: T) =>
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);

const file = {
  root: "project",
  projectId: "p1",
  path: "packages/api/CLAUDE.md",
  provider: "claude",
  kind: "memory",
  scope: "project",
  name: "CLAUDE.md",
  absolutePath: "C:/repo/packages/api/CLAUDE.md",
  exists: true,
  sizeBytes: 10,
  modifiedAt: "2026-11-07T10:00:00.000Z",
  onDemand: true,
} as const;

describe("agent configuration contracts", () => {
  it("round-trips files, MCP specs and the loaded view", () => {
    roundTrip(AgentConfigFile, file);
    roundTrip(McpServerSpec, { type: "stdio", command: "npx", args: ["-y", "x"], env: { A: "1" } });
    roundTrip(McpServerSpec, {
      type: "http",
      url: "https://example.com/mcp",
      bearerTokenEnvVar: "TOKEN",
      enabled: false,
      extra: { startup_timeout_sec: 20 },
    });
    roundTrip(LoadedAgentConfig, {
      sessionId: "s1",
      provider: "claude",
      cwd: "C:/repo",
      memory: [file],
      skills: [
        { provider: "claude", scope: "user", name: "deploy", file: { ...file, kind: "skill" } },
      ],
      subagents: [],
      mcpServers: [
        {
          provider: "codeden",
          scope: "user",
          name: "codeden",
          spec: { type: "http", url: "http://127.0.0.1:1/mcp" },
          file: "CodeDen",
          projectId: null,
        },
      ],
    });
  });

  it("validates locators and server names", () => {
    expect(AgentConfigLocator.safeParse({ root: "elsewhere", path: "x" }).success).toBe(false);
    const bad = {
      provider: "codex",
      scope: "user",
      name: "has space",
      spec: { type: "stdio", command: "x" },
    };
    expect(McpServerUpsertRequest.safeParse(bad).success).toBe(false);
  });
});
