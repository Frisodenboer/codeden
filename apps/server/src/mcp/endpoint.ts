import { CODEDEN_VERSION } from "@codeden/contracts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "./registry";
import type { McpTokenStore } from "./tokens";

export interface McpEndpointDeps {
  tokens: McpTokenStore;
  registry: ToolRegistry;
  log?: (message: string) => void;
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

function bearerOf(request: Request): string | undefined {
  const auth = request.headers.get("authorization") ?? "";
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : undefined;
}

/**
 * The internal MCP endpoint (`/mcp`, §4.4, §8.3): Streamable HTTP in stateless mode, one MCP
 * server and transport per request. Every request needs a live per-session bearer token,
 * whose role decides which tools are listed and callable. Responses stream as SSE, so a
 * long-running tool (`ask_user`) keeps the connection alive while it waits.
 */
export function createMcpHandler(deps: McpEndpointDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const claims = deps.tokens.verify(bearerOf(request));
    if (!claims) {
      return jsonRpcError(401, "Missing or invalid CodeDen session token", {
        "www-authenticate": 'Bearer realm="codeden"',
      });
    }
    if (request.method !== "POST") {
      return jsonRpcError(405, "Method not allowed (stateless endpoint)", { allow: "POST" });
    }

    const server = new Server(
      { name: "codeden", version: CODEDEN_VERSION },
      {
        capabilities: { tools: { listChanged: false } },
        instructions:
          "CodeDen tools: report progress, ask the user, share images, suggest follow-ups and finish.",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: deps.registry.list(claims.role),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const result = await deps.registry.call(req.params.name, req.params.arguments, {
        role: claims.role,
        sessionId: claims.sessionId,
        projectId: claims.projectId,
        caller: "mcp",
        signal: extra.signal,
      });
      return { content: [{ type: "text", text: result.text }], isError: result.isError };
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    request.signal.addEventListener("abort", () => void server.close(), { once: true });
    try {
      return await transport.handleRequest(request);
    } catch (error) {
      deps.log?.(`mcp: ${error instanceof Error ? error.message : String(error)}`);
      return jsonRpcError(500, "Internal error");
    }
  };
}
