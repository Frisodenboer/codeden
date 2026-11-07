import type { Role, ToolContext, ToolScope } from "@codeden/contracts";
import type { z } from "zod";
import type { AppServices } from "../services/container";

/** What a tool handler gets: the caller (from its token) plus the application services. */
export type ServerToolContext<S extends ToolScope = ToolScope> = ToolContext<S> & {
  services: AppServices;
};

/**
 * A CodeDen tool (§8.3): one registry, exposed to agents over MCP and callable by API
 * handlers, so agents and the UI share the same services and can never drift apart.
 */
export interface ServerTool<TInput extends z.ZodType = z.ZodType, S extends ToolScope = ToolScope> {
  /** snake_case, unique across the registry. */
  name: string;
  /** Shown to agents; written for a model. */
  description: string;
  /** Roles that see and may call the tool; it is not listed for anyone else. */
  roles: readonly Role[];
  /** What the handler is bound to, resolved from the caller's token. */
  scope: S;
  input: TInput;
  /** Core tools load upfront; the rest may be deferred behind the agent's tool search. */
  alwaysLoad?: boolean;
  /** Hidden when false (e.g. a tool whose engine is not configured). */
  isAvailable?: (services: AppServices) => boolean;
  /** Returns text (or a JSON-serialisable value) for the agent. */
  handler: (input: z.output<TInput>, ctx: ServerToolContext<S>) => Promise<unknown>;
}

/** Identity helper that infers a tool's input and scope types. */
export function defineTool<TInput extends z.ZodType, S extends ToolScope>(
  tool: ServerTool<TInput, S>,
): ServerTool<TInput, S> {
  return tool;
}

/** Any tool, for registries. */
// biome-ignore lint/suspicious/noExplicitAny: registries hold heterogeneous tools.
export type AnyServerTool = ServerTool<any, ToolScope>;

/** A tool failure reported to the agent as an MCP error result (not a protocol error). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
