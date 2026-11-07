import { z } from "zod";
import { Id } from "./common";
import { Artifact } from "./entities/artifact";

/**
 * Image generation settings screen and test button (§12.5). The `generate_image` MCP tool
 * itself is described in the server's tool registry.
 */

export const ImageEngineId = z.enum(["codex", "gemini", "openai"]);
export type ImageEngineId = z.infer<typeof ImageEngineId>;

/** One engine as the Settings screen shows it. */
export const ImageEngineStatus = z.object({
  id: ImageEngineId,
  label: z.string(),
  available: z.boolean(),
  /** Why it is unavailable, or a note when available (e.g. the login method). */
  reason: z.string().optional(),
  requiresApiKey: z.boolean(),
  referenceImages: z.boolean(),
  exactSize: z.boolean(),
  defaultModel: z.string(),
});
export type ImageEngineStatus = z.infer<typeof ImageEngineStatus>;

/** Images generated today (local date), for the daily caps. */
export const ImageUsage = z.object({
  /** `YYYY-MM-DD`. */
  date: z.string(),
  total: z.int().nonnegative(),
  byProject: z.record(z.string(), z.int().nonnegative()),
});
export type ImageUsage = z.infer<typeof ImageUsage>;

/** `GET /api/images/engines?projectId=`: engines, the one `generate_image` would use, usage. */
export const ImageEnginesResponse = z.object({
  engines: z.array(ImageEngineStatus),
  /** The engine chosen for these settings (with the project's override applied), or why none. */
  active: z.object({ engine: ImageEngineId.nullable(), reason: z.string().optional() }),
  usage: ImageUsage,
  /** Effective daily cap for the project (or the global cap without one). */
  dailyCap: z.int().nonnegative(),
});
export type ImageEnginesResponse = z.infer<typeof ImageEnginesResponse>;

/**
 * `POST /api/images/test`: check an engine (default: the active one). With `generate`
 * (default true) one small image is generated and stored as an artifact; it counts toward
 * the daily cap.
 */
export const ImageTestRequest = z.object({
  engine: z.enum(["auto", "codex", "gemini", "openai"]).optional(),
  projectId: Id.optional(),
  generate: z.boolean().optional(),
  prompt: z.string().min(1).max(2_000).optional(),
});
export type ImageTestRequest = z.infer<typeof ImageTestRequest>;

export const ImageTestResponse = z.object({
  ok: z.boolean(),
  engine: ImageEngineId.nullable(),
  model: z.string().optional(),
  durationMs: z.int().nonnegative(),
  /** The generated test image. */
  artifact: Artifact.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type ImageTestResponse = z.infer<typeof ImageTestResponse>;
