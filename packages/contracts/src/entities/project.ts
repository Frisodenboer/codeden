import { z } from "zod";
import { AutonomyLevel, Id, ProviderId, Timestamp } from "../common";
import { AutonomyMode, DEFAULT_VISION_PATH, FactoryLimits } from "../factory";

const projectBase = {
  id: Id,
  name: z.string().min(1),
  /** Short, filesystem-safe name used in worktree paths (`wt/<slug>/...`). */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  /** Absolute path of the main checkout. */
  path: z.string().min(1),
  defaultBranch: z.string().nullable(),
  /** Overrides the global default provider for new agent sessions. */
  defaultProvider: ProviderId.nullable(),
  /** Overrides the global default per-session autonomy level (§11.2). */
  autonomy: AutonomyLevel.nullable(),
  /** Project autonomy mode (§10.1). */
  autonomyMode: AutonomyMode.default("assisted"),
  /** Vision file, relative to the repo root; required for autopilot and dark factory. */
  visionPath: z.string().min(1).default(DEFAULT_VISION_PATH),
  factoryLimits: FactoryLimits.prefault({}),
  /** Stops this project's factory loop and all its sessions. */
  killSwitch: z.boolean().default(false),
  /** IANA timezone for cron automations; machine timezone when null. */
  timezone: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  archivedAt: Timestamp.nullable(),
};

/** GitHub repository coordinates for a `github` project. */
export const GitHubRepo = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  remoteUrl: z.string().min(1),
  defaultBranch: z.string().min(1),
});
export type GitHubRepo = z.infer<typeof GitHubRepo>;

/**
 * A project. `github` projects get the full issue/PR/evidence flow; `local` projects
 * (no GitHub remote) get sessions, worktrees, checkpoints, diffs and automations only (§9).
 */
export const Project = z.discriminatedUnion("kind", [
  z.object({ ...projectBase, kind: z.literal("github"), github: GitHubRepo }),
  z.object({ ...projectBase, kind: z.literal("local") }),
]);
export type Project = z.infer<typeof Project>;
export type ProjectKind = Project["kind"];
