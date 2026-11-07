import { z } from "zod";
import { Id, Timestamp } from "../common";

export const ArtifactKind = z.enum(["image", "screenshot", "file", "tool_output", "evidence"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/** A stored file (screenshot, generated image, shared file, full tool output) under `artifacts/`. */
export const Artifact = z.object({
  id: Id,
  kind: ArtifactKind,
  name: z.string(),
  mediaType: z.string(),
  /** Path relative to `<home>/artifacts/`. */
  path: z.string(),
  sizeBytes: z.int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  projectId: Id.nullable(),
  sessionId: Id.nullable(),
  threadId: Id.nullable(),
  itemId: Id.nullable(),
  createdAt: Timestamp,
});
export type Artifact = z.infer<typeof Artifact>;
