import { describe, expect, it } from "vitest";
import { trustedMcpTools } from "../src/claude/options";
import { mcpOverride } from "../src/codex/config";

const codeden = {
  transport: "http" as const,
  name: "codeden",
  url: "http://127.0.0.1:5000/mcp",
  headers: { Authorization: "Bearer cdm_x" },
  toolTimeoutSec: 600,
  trusted: true,
};

describe("MCP server injection", () => {
  it("maps CodeDen's server to a Codex override with timeout and no approval prompts", () => {
    expect(mcpOverride(codeden)).toEqual({
      "mcp_servers.codeden": {
        url: codeden.url,
        http_headers: codeden.headers,
        tool_timeout_sec: 600,
        default_tools_approval_mode: "approve",
      },
    });
    expect(mcpOverride({ ...codeden, trusted: undefined, toolTimeoutSec: undefined })).toEqual({
      "mcp_servers.codeden": { url: codeden.url, http_headers: codeden.headers },
    });
  });

  it("allows every tool of trusted servers in Claude", () => {
    expect(trustedMcpTools([codeden])).toEqual({ allowedTools: ["mcp__codeden"] });
    expect(trustedMcpTools([{ ...codeden, trusted: false }])).toEqual({});
  });
});
