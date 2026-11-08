import { type Attachment, ImageMediaType } from "@codeden/contracts";
import { FileText, X } from "lucide-react";
import type { ComposerAttachment } from "@/stores/composer";

let n = 0;
const nextId = () => `att-${Date.now().toString(36)}-${n++}`;

/** Composer attachments as message input: images inline as base64, files by path. */
export function toInputAttachments(attachments: ComposerAttachment[]): Attachment[] {
  return attachments.map((a) =>
    a.type === "image"
      ? {
          type: "image",
          mediaType: a.mediaType,
          name: a.name,
          source: { type: "base64", data: a.data },
        }
      : { type: "file", path: a.path, name: a.name },
  );
}

/** Read dropped or pasted files into composer attachments (images inline, others as files). */
export async function filesToAttachments(files: File[]): Promise<ComposerAttachment[]> {
  const out: ComposerAttachment[] = [];
  for (const file of files) {
    const media = ImageMediaType.safeParse(file.type);
    if (media.success) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      out.push({
        id: nextId(),
        type: "image",
        name: file.name || "pasted-image.png",
        mediaType: media.data,
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
        previewUrl: dataUrl,
      });
    } else {
      out.push({ id: nextId(), type: "file", name: file.name, path: file.name });
    }
  }
  return out;
}

/** Thumbnails and file chips above the composer text. */
export function AttachmentStrip({
  items,
  onRemove,
}: {
  items: ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {items.map((a) => (
        <div key={a.id} className="group relative animate-rise">
          {a.type === "image" ? (
            <img
              src={a.previewUrl}
              alt={a.name}
              className="size-14 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex h-14 max-w-44 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-2xs">{a.name}</span>
            </div>
          )}
          <button
            type="button"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.id)}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
