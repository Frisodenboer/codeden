import { z } from "zod";
import { ProviderId } from "./common";

/** Dev-server definition in `.codeden/project.json`. */
export const DevServerConfig = z.object({
  /** Shell command that starts the dev server, e.g. `pnpm dev`. */
  command: z.string().min(1),
  /** Port the dev server listens on, when known (used for discovery). */
  port: z.int().min(1).max(65535).optional(),
  /** Working directory relative to the repo root. */
  cwd: z.string().optional(),
});
export type DevServerConfig = z.infer<typeof DevServerConfig>;

/**
 * `.codeden/project.json` at a repository root (§9). Read by the runner after a worktree
 * is created: `setup` commands run in the new worktree (output streamed as
 * `workspace.setup` events), `devServer` feeds dev-server discovery and `defaultProvider`
 * is reported back to the server. Unknown keys are ignored.
 */
export const ProjectConfigFile = z.object({
  /** Commands run in order in every new worktree, e.g. `pnpm install`. */
  setup: z.array(z.string().min(1)).default([]),
  /** A bare command string or a full definition. */
  devServer: z.union([z.string().min(1), DevServerConfig]).optional(),
  defaultProvider: ProviderId.optional(),
});
export type ProjectConfigFile = z.infer<typeof ProjectConfigFile>;

/** Normalize `devServer` to its object form. */
export function devServerOf(config: ProjectConfigFile): DevServerConfig | undefined {
  const value = config.devServer;
  if (value === undefined) return undefined;
  return typeof value === "string" ? { command: value } : value;
}
