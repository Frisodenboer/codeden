import { z } from "zod";

/**
 * Project autonomy modes and dark-factory mode (§10.1). Types only; the factory loop itself
 * lands in M3b.
 */

/**
 * A ladder climbed one step at a time:
 * - `manual`: you find work and merge; you drive every session.
 * - `assisted` (default): you, the PM and automations find work; you merge.
 * - `autopilot`: the PM finds work; CodeDen merges when every merge check passes.
 * - `dark_factory`: the PM finds work continuously from the vision; CodeDen merges.
 */
export const AutonomyMode = z.enum(["manual", "assisted", "autopilot", "dark_factory"]);
export type AutonomyMode = z.infer<typeof AutonomyMode>;

/** Default location of a project's vision file, relative to the repo root. */
export const DEFAULT_VISION_PATH = ".codeden/VISION.md";

/** Limits enforced by the server (never left to agent judgement) for autopilot/dark factory. */
export const FactoryLimits = z.object({
  maxConcurrentSessions: z.int().positive().default(2),
  maxMergesPerDay: z.int().nonnegative().default(5),
  /** Daily spend budget; either or both may be set. */
  dailyBudget: z
    .object({
      tokens: z.int().positive().optional(),
      usd: z.number().positive().optional(),
    })
    .prefault({}),
  /** Pause the loop after this many failed merge checks or reverts in a row. */
  pauseAfterConsecutiveFailures: z.int().positive().default(3),
  /** Globs that always escalate to a human (auth, payments, migrations, infra, licensing). */
  protectedPaths: z.array(z.string()).default([]),
  /** Deploys/releases are off unless explicitly enabled. */
  allowDeploys: z.boolean().default(false),
});
export type FactoryLimits = z.infer<typeof FactoryLimits>;

/** State of a project's factory loop (discover -> plan -> build -> verify -> merge -> watch). */
export const FactoryLoopState = z.enum([
  "idle",
  "discovering",
  "building",
  "verifying",
  "paused",
  "stopped",
]);
export type FactoryLoopState = z.infer<typeof FactoryLoopState>;
