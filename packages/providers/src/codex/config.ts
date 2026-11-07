import type { AutonomyLevel, McpServerConfig, SessionOptions, UserInput } from "@codeden/contracts";
import type { JsonValue } from "./protocol/serde_json/JsonValue";
import type { AskForApproval, UserInput as CodexUserInput, SandboxMode } from "./protocol/v2";

/**
 * Native sandbox + approval policy per autonomy level (§11.2):
 * - supervised -> `untrusted`: every command that isn't known-safe and every patch asks
 * - auto       -> workspace-write sandbox + `on-request`: the sandbox confines writes and
 *                 network; escaping it (outside the worktree, network, force pushes) asks
 * - full       -> workspace-write + `never`, with network on: no approvals, still confined
 *                 to the worktree
 */
export function codexPolicy(
  autonomy: AutonomyLevel,
  readOnly = false,
): {
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
  networkAccess: boolean;
} {
  // Read-only sessions (orchestrator, PMs, §11.2): the sandbox refuses every write.
  if (readOnly) return { approvalPolicy: "never", sandbox: "read-only", networkAccess: false };
  if (autonomy === "supervised")
    return { approvalPolicy: "untrusted", sandbox: "workspace-write", networkAccess: false };
  if (autonomy === "auto")
    return { approvalPolicy: "on-request", sandbox: "workspace-write", networkAccess: false };
  return { approvalPolicy: "never", sandbox: "workspace-write", networkAccess: true };
}

/**
 * Config overrides for `thread/start` / `thread/resume` (same semantics as `-c key=value`).
 * Sent over stdin as JSON, so MCP bearer tokens never appear on a command line.
 */
export function codexConfigOverrides(opts: SessionOptions): Record<string, JsonValue> {
  const { networkAccess } = codexPolicy(opts.autonomy, opts.readOnly);
  const config: Record<string, JsonValue> = {
    "sandbox_workspace_write.network_access": networkAccess,
  };
  if (opts.additionalDirectories.length) {
    config["sandbox_workspace_write.writable_roots"] = [...opts.additionalDirectories];
  }
  for (const server of opts.mcpServers) Object.assign(config, mcpOverride(server));
  return config;
}

/** One MCP server as a `mcp_servers.<name>` override. */
export function mcpOverride(server: McpServerConfig): Record<string, JsonValue> {
  const key = `mcp_servers.${server.name}`;
  if (server.transport === "http") {
    return {
      [key]: {
        url: server.url,
        ...(server.headers ? { http_headers: server.headers } : {}),
        ...(server.toolTimeoutSec ? { tool_timeout_sec: server.toolTimeoutSec } : {}),
        // CodeDen's own tools run without per-call approval prompts.
        ...(server.trusted ? { default_tools_approval_mode: "approve" } : {}),
      },
    };
  }
  return {
    [key]: {
      command: server.command,
      args: server.args,
      ...(server.env ? { env: server.env } : {}),
    },
  };
}

/** CodeDen `UserInput` -> Codex turn input. */
export function toCodexInput(input: UserInput): CodexUserInput[] {
  const parts: CodexUserInput[] = [{ type: "text", text: input.text, text_elements: [] }];
  for (const attachment of input.attachments) {
    if (attachment.type === "file") {
      parts.push({
        type: "mention",
        name: attachment.name ?? attachment.path,
        path: attachment.path,
      });
      continue;
    }
    const source = attachment.source;
    if (source.type === "path") parts.push({ type: "localImage", path: source.path });
    else if (source.type === "base64") {
      parts.push({ type: "image", url: `data:${attachment.mediaType};base64,${source.data}` });
    } else {
      throw new Error("Artifact attachments must be resolved to a path or base64 before sending");
    }
  }
  return parts;
}
