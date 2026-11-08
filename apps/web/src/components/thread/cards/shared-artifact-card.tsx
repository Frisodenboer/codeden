import type { ItemOf } from "@codeden/contracts";
import { Download, FileText } from "lucide-react";
import { ImageGallery, ImageThumbnail } from "@/components/common/image-viewer";
import { useClient } from "@/lib/api";
import { formatBytes } from "@/lib/format";

/** Data the `share_to_chat` tool attaches to its `shared_artifact` notice. */
export interface SharedArtifactData {
  artifactId: string;
  name: string;
  mediaType: string;
  sizeBytes?: number;
}

/** Read the artifact reference from a `shared_artifact` notice, if well formed. */
export function sharedArtifactOf(item: ItemOf<"notice">): SharedArtifactData | null {
  if (item.code !== "shared_artifact") return null;
  const d = item.data as Record<string, unknown> | null | undefined;
  if (!d || typeof d.artifactId !== "string") return null;
  return {
    artifactId: d.artifactId,
    name: typeof d.name === "string" ? d.name : d.artifactId,
    mediaType: typeof d.mediaType === "string" ? d.mediaType : "application/octet-stream",
    sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : undefined,
  };
}

const INLINE = /^image\/(png|jpeg|gif|webp)$/;

/** A file or screenshot the agent shared to the chat: images inline, other files as a download. */
export function SharedArtifactCard({
  item,
  artifact,
}: {
  item: ItemOf<"notice">;
  artifact: SharedArtifactData;
}) {
  const client = useClient();
  const url = client.artifactUrl(artifact.artifactId);
  const caption = item.message && item.message !== artifact.name ? item.message : null;
  if (INLINE.test(artifact.mediaType)) {
    const image = {
      src: url,
      name: artifact.name,
      caption: caption ?? undefined,
      downloadName: artifact.name,
    };
    return (
      <ImageGallery images={[image]}>
        <figure className="space-y-1.5" data-testid="shared-artifact">
          <ImageThumbnail index={0} className="block w-fit max-w-full rounded-lg">
            <img
              src={url}
              alt={caption ?? artifact.name}
              loading="lazy"
              className="max-h-[28rem] w-auto max-w-full rounded-lg border border-border bg-muted/30 shadow-sm"
            />
          </ImageThumbnail>
          <figcaption className="text-2xs text-muted-foreground">
            {caption ?? artifact.name}
          </figcaption>
        </figure>
      </ImageGallery>
    );
  }
  return (
    <a
      href={url}
      download={artifact.name}
      data-testid="shared-artifact"
      className="flex max-w-md items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 transition-colors hover:bg-accent/40"
    >
      <FileText className="size-5 shrink-0 text-primary/80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{artifact.name}</span>
        <span className="block truncate text-2xs text-muted-foreground">
          {caption ?? artifact.mediaType}
          {artifact.sizeBytes !== undefined ? ` · ${formatBytes(artifact.sizeBytes)}` : ""}
        </span>
      </span>
      <Download className="size-4 shrink-0 text-muted-foreground" />
    </a>
  );
}
