import type { Attachment, ItemOf } from "@codeden/contracts";
import { Copy, FileText } from "lucide-react";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { platform } from "@/lib/platform";
import { Markdown } from "./markdown";

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const client = useClient();
  if (attachment.type === "file") {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 font-mono text-2xs text-muted-foreground">
        <FileText className="size-3.5" />
        {attachment.name ?? attachment.path}
      </span>
    );
  }
  const src =
    attachment.source.type === "base64"
      ? `data:${attachment.mediaType};base64,${attachment.source.data}`
      : attachment.source.type === "artifact"
        ? client.artifactUrl(attachment.source.artifactId)
        : undefined;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-lg border border-border"
    >
      <img
        src={src}
        alt={attachment.name ?? "Attached image"}
        className="h-28 w-auto max-w-64 object-cover"
      />
    </a>
  );
}

/** User message: a soft right-aligned bubble with attachments above the text. */
export function UserMessage({ item }: { item: ItemOf<"user_message"> }) {
  const { text, attachments } = item.input;
  return (
    <div className="group flex flex-col items-end gap-1.5 animate-rise">
      {attachments.length > 0 && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
          {attachments.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: attachments have no ids and never reorder.
            <AttachmentView key={`${item.id}-${i}`} attachment={a} />
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-message px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
          {text}
        </div>
      )}
    </div>
  );
}

/** Assistant message: plain markdown, no bubble, with a hover copy action. */
export function AssistantMessage({
  item,
  streaming,
}: {
  item: ItemOf<"assistant_message">;
  streaming: boolean;
}) {
  return (
    <div className="group relative">
      <Markdown streaming={streaming}>{item.text}</Markdown>
      {!streaming && item.text && (
        <button
          type="button"
          className="absolute -bottom-5 left-0 flex items-center gap-1 text-3xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
          onClick={() => {
            void platform.writeClipboard(item.text);
            toast.success("Copied message");
          }}
        >
          <Copy className="size-3" /> Copy
        </button>
      )}
    </div>
  );
}
