import { z } from "zod";
import { Id } from "./common";

/** Where the bytes of an attachment come from. */
export const AttachmentSource = z.discriminatedUnion("type", [
  /** Inline base64 data (pasted images). */
  z.object({ type: z.literal("base64"), data: z.base64() }),
  /** A file on the runner's filesystem. */
  z.object({ type: z.literal("path"), path: z.string().min(1) }),
  /** A stored CodeDen artifact (§6 `artifacts/`). */
  z.object({ type: z.literal("artifact"), artifactId: Id }),
]);
export type AttachmentSource = z.infer<typeof AttachmentSource>;

/** Image MIME types accepted as agent input. */
export const ImageMediaType = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export type ImageMediaType = z.infer<typeof ImageMediaType>;

/** An attachment on a user message: an image, or a file reference. */
export const Attachment = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    mediaType: ImageMediaType,
    source: AttachmentSource,
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("file"),
    /** Path on the runner, usually inside the session worktree. */
    path: z.string().min(1),
    name: z.string().optional(),
    mediaType: z.string().optional(),
  }),
]);
export type Attachment = z.infer<typeof Attachment>;

/** Input that starts or steers a turn: text plus optional image/file attachments. */
export const UserInput = z.object({
  text: z.string(),
  attachments: z.array(Attachment).default([]),
});
export type UserInput = z.infer<typeof UserInput>;
/** Input shape accepted before defaults are applied (`attachments` optional). */
export type UserInputInit = z.input<typeof UserInput>;
