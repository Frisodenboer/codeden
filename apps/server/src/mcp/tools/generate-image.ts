import { IMAGE_ASPECT_RATIOS, MAX_IMAGE_COUNT } from "@codeden/providers";
import { z } from "zod";
import { defineTool } from "../define";
import { postSharedArtifact } from "../transcript";

/**
 * `generate_image` (§12.5), for every role: whichever image engine Settings picks (Codex by
 * default when logged in) generates the images into the caller's worktree; each one is also
 * stored as an artifact and shown in the chat. Hidden when no engine is available.
 */
export const generateImage = defineTool({
  name: "generate_image",
  description:
    "Generate images (hero images, illustrations, icons, mockups) and save them into your working directory. Returns the file paths. Images are also shown to the user in the chat. Pass `referenceImages` (paths) to edit or vary existing images.",
  roles: ["agent", "pm", "orchestrator"],
  scope: "session",
  isAvailable: (services) => services.images.availableNow(),
  input: z.object({
    prompt: z.string().min(1).max(8_000).describe("What the image should show, in detail"),
    aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
    size: z
      .string()
      .regex(/^(\d{2,5}x\d{2,5}|[124]K)$/i)
      .optional()
      .describe("WIDTHxHEIGHT (e.g. 1536x1024) or 1K/2K/4K; default from Settings"),
    quality: z.enum(["auto", "low", "medium", "high"]).optional(),
    count: z.int().min(1).max(MAX_IMAGE_COUNT).optional(),
    referenceImages: z.array(z.string().min(1)).max(4).optional(),
    outputPath: z
      .string()
      .max(500)
      .optional()
      .describe(
        "File or folder inside your working directory, e.g. public/hero.png (default generated-images/)",
      ),
    share: z.boolean().optional().describe("Show the images in the chat (default true)"),
  }),
  handler: async (input, { services, sessionId, role, signal }) => {
    const result = await services.images.generate({ ...input, sessionId, role, signal });
    if (input.share !== false) {
      for (const image of result.images) {
        try {
          postSharedArtifact(services, sessionId, image.artifact, input.prompt.slice(0, 200));
        } catch {
          // No turn to attach to (e.g. called from the API): the files are still saved.
        }
      }
    }
    const lines = result.images.map((i) => `- ${i.relativePath ?? i.path}`);
    return [
      `Generated ${result.images.length} image${result.images.length === 1 ? "" : "s"} with ${result.engine}${result.model ? ` (${result.model})` : ""}:`,
      ...lines,
      ...(result.revisedPrompt ? [`Revised prompt: ${result.revisedPrompt}`] : []),
    ].join("\n");
  },
});
