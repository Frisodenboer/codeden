import { z } from "zod";
import { Id, Role } from "./common";

/**
 * Internal MCP tool definitions (§8.3). One registry is exposed through MCP and also called
 * directly by the UI's API handlers. Only the types live here; the registry is in the server.
 */

/**
 * What a tool's handler is bound to, resolved from the caller's token:
 * - `global`: no project (orchestrator tools).
 * - `project`: the caller's project.
 * - `session`: the caller's own session (and its project).
 */
export const ToolScope = z.enum(["global", "project", "session"]);
export type ToolScope = z.infer<typeof ToolScope>;

/** Claims encoded in a per-session MCP bearer token; revoked when the session ends. */
export const McpTokenClaims = z.object({
  role: Role,
  sessionId: Id,
  projectId: Id.nullable(),
  /** Token id, used for revocation. */
  jti: z.string().min(1),
});
export type McpTokenClaims = z.infer<typeof McpTokenClaims>;

/** Context passed to a tool handler. Narrowed by the tool's scope. */
export interface ToolContextBase {
  role: Role;
  /** `mcp` when an agent called it, `ui` when an API handler did. */
  caller: "mcp" | "ui";
  signal: AbortSignal;
}
export interface GlobalToolContext extends ToolContextBase {
  sessionId: string | null;
  projectId: string | null;
}
export interface ProjectToolContext extends ToolContextBase {
  sessionId: string | null;
  projectId: string;
}
export interface SessionToolContext extends ToolContextBase {
  sessionId: string;
  projectId: string | null;
}
export type ToolContext<S extends ToolScope = ToolScope> = S extends "session"
  ? SessionToolContext
  : S extends "project"
    ? ProjectToolContext
    : GlobalToolContext;

/** A tool definition. `name` is snake_case and unique across the registry. */
export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
  S extends ToolScope = ToolScope,
> {
  name: string;
  /** Shown to agents; write it for a model, not a human. */
  description: string;
  /** Roles that may see and call the tool. Tools outside the caller's role aren't listed. */
  roles: readonly Role[];
  scope: S;
  input: TInput;
  output?: z.ZodType<TOutput>;
  /** Core tools are always loaded; others are deferred behind tool search. */
  core?: boolean;
  /** Hidden when the predicate is false (e.g. `generate_image` with no engine). */
  isAvailable?: () => boolean | Promise<boolean>;
  handler: (input: z.output<TInput>, ctx: ToolContext<S>) => Promise<TOutput>;
}

/** Identity helper that infers a tool's input/output/scope types. */
export function defineTool<TInput extends z.ZodType, TOutput, S extends ToolScope>(
  def: ToolDefinition<TInput, TOutput, S>,
): ToolDefinition<TInput, TOutput, S> {
  return def;
}

/** Any tool, for registries. */
// biome-ignore lint/suspicious/noExplicitAny: registries hold heterogeneous tools.
export type AnyToolDefinition = ToolDefinition<z.ZodType, any, ToolScope>;
