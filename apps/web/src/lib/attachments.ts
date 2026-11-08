import type { Attachment } from "@codeden/contracts";
import type { ViewerImage } from "@/components/common/image-viewer";

/**
 * The URL an image attachment loads from, or `null` when it can only be shown by name (a file,
 * or a path the server could not map to an artifact; the browser never loads filesystem paths).
 */
export function attachmentImageSrc(
  attachment: Attachment,
  artifactUrl: (id: string) => string,
): string | null {
  if (attachment.type !== "image") return null;
  const { source } = attachment;
  if (source.type === "base64") return `data:${attachment.mediaType};base64,${source.data}`;
  if (source.type === "artifact") return artifactUrl(source.artifactId);
  return null;
}

/**
 * The images among `attachments` for the image viewer, and each attachment's position among
 * them (`-1` for anything shown by name instead).
 */
export function attachmentGallery(
  attachments: Attachment[],
  artifactUrl: (id: string) => string,
): { images: ViewerImage[]; positions: number[] } {
  const images: ViewerImage[] = [];
  const positions = attachments.map((attachment) => {
    const src = attachmentImageSrc(attachment, artifactUrl);
    if (!src || attachment.type !== "image") return -1;
    const subtype = attachment.mediaType.split("/")[1] ?? "png";
    images.push({
      src,
      name: attachment.name ?? "Attached image",
      downloadName: attachment.name ?? `image.${subtype}`,
    });
    return images.length - 1;
  });
  return { images, positions };
}
