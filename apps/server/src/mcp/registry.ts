import type { McpTokenClaims } from "@codeden/contracts";
import { z } from "zod";
import type { AppServices } from "../services/container";
import { errorMessage, ServiceError } from "../services/errors";
import { type AnyServerTool, ToolError } from "./define";

/** A tool as listed over MCP (`tools/list`). */
export interface ListedTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  _meta?: Record<string, unknown>;
}

/** Result of one tool call, ready to become an MCP `CallToolResult`. */
export interface ToolCallResult {
  text: string;
  isError: boolean;
}

/** Who is calling: an agent (claims from its MCP token) or an API handler. */
export interface ToolCaller extends Omit<McpTokenClaims, "jti"> {
  caller: "mcp" | "ui";
  signal: AbortSignal;
}

/**
 * The tool registry (§8.3). Tools are filtered by the caller's role: a tool outside the role
 * is neither listed nor callable. Inputs are validated with the tool's zod schema.
 */
export class ToolRegistry {
  private readonly byName = new Map<string, AnyServerTool>();

  constructor(
    tools: AnyServerTool[],
    private readonly services: AppServices,
    private readonly log?: (message: string) => void,
  ) {
    for (const tool of tools) {
      if (this.byName.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
      this.byName.set(tool.name, tool);
    }
  }

  /** Tools visible to a role, in registration order. */
  forRole(role: McpTokenClaims["role"]): AnyServerTool[] {
    return [...this.byName.values()].filter(
      (t) => t.roles.includes(role) && (t.isAvailable?.(this.services) ?? true),
    );
  }

  /** MCP `tools/list` entries for a role. */
  list(role: McpTokenClaims["role"]): ListedTool[] {
    return this.forRole(role).map((tool) => describeTool(tool));
  }

  async call(name: string, args: unknown, caller: ToolCaller): Promise<ToolCallResult> {
    const tool = this.forRole(caller.role).find((t) => t.name === name);
    if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) {
      return { text: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
    }
    if (tool.scope === "session" && !caller.sessionId) {
      return { text: `${name} needs a session`, isError: true };
    }
    if (tool.scope === "project" && !caller.projectId) {
      return { text: `${name} needs a project`, isError: true };
    }
    try {
      const output = await tool.handler(parsed.data, {
        role: caller.role,
        caller: caller.caller,
        signal: caller.signal,
        sessionId: caller.sessionId,
        projectId: caller.projectId,
        services: this.services,
      } as never);
      return { text: typeof output === "string" ? output : JSON.stringify(output), isError: false };
    } catch (error) {
      if (error instanceof ToolError || error instanceof ServiceError) {
        return { text: error.message, isError: true };
      }
      this.log?.(
        `tool ${name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      return { text: `${name} failed: ${errorMessage(error)}`, isError: true };
    }
  }
}

/** JSON Schema and metadata of a tool for MCP clients. */
export function describeTool(tool: AnyServerTool): ListedTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input, { io: "input" }) as Record<
    string,
    unknown
  >;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { ...schema, type: "object" },
    // Claude Code keeps tools marked this way out of tool-search deferral.
    ...(tool.alwaysLoad ? { _meta: { "anthropic/alwaysLoad": true } } : {}),
  };
}
