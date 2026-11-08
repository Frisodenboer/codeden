import type { Attachment, QueuedMessage, Session } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, ListOrdered, Pencil, SendHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useClient } from "@/lib/api";
import { useSnapshotData } from "@/lib/queries";
import { queueKey, queuePosition, senderLabel, useQueuedMessages } from "@/lib/queue";

/** The image's URL, or `null` when it can only be shown by name (a file, an unmapped path). */
function imageSrc(attachment: Attachment, artifactUrl: (id: string) => string): string | null {
  if (attachment.type !== "image") return null;
  const { source } = attachment;
  if (source.type === "base64") return `data:${attachment.mediaType};base64,${source.data}`;
  if (source.type === "artifact") return artifactUrl(source.artifactId);
  return null;
}

function attachmentName(attachment: Attachment): string {
  if (attachment.type === "file") return attachment.name ?? attachment.path;
  if (attachment.source.type === "path") return attachment.name ?? attachment.source.path;
  return attachment.name ?? "image";
}

function Thumbnail({ attachment }: { attachment: Attachment }) {
  const client = useClient();
  const src = imageSrc(attachment, client.artifactUrl);
  if (src) {
    return (
      <img
        src={src}
        alt={attachment.name ?? "Attached image"}
        className="size-8 rounded-md border border-border object-cover"
      />
    );
  }
  const name = attachmentName(attachment);
  return (
    <span className="inline-flex h-8 max-w-40 items-center gap-1 rounded-md border border-border px-1.5 font-mono text-3xs text-muted-foreground">
      <FileText className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function QueuedRow({
  session,
  message,
  index,
  canSteer,
}: {
  session: Session;
  message: QueuedMessage;
  index: number;
  canSteer: boolean;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queueKey(session.id) });
  // A 409 means delivery took the message first: say so and let the list catch up.
  const onError = (e: Error) => {
    toast.error(e.message || "Couldn't change the queued message");
    void refresh();
  };
  const edit = useMutation({
    mutationFn: (text: string) => client.queue.edit(session.id, message.id, text),
    onSuccess: () => {
      setDraft(null);
      void refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => client.queue.remove(session.id, message.id),
    onSuccess: () => void refresh(),
    onError,
  });
  const sendNow = useMutation({
    mutationFn: () => client.queue.sendNow(session.id, message.id),
    onSuccess: (res) => {
      toast(res.status === "steered" ? "Sent to the running turn" : "Sent");
      void refresh();
    },
    onError,
  });
  const busy = edit.isPending || remove.isPending || sendNow.isPending;
  const from = senderLabel(message.from);
  const save = () => {
    if (draft === null) return;
    if (draft.trim() === message.input.text.trim()) setDraft(null);
    else edit.mutate(draft.trim());
  };

  return (
    <li
      className="group flex items-start gap-2.5 px-3 py-2"
      data-testid="queued-message"
      aria-label={`${queuePosition(index)} queued message`}
    >
      <span className="mt-0.5 w-9 shrink-0 text-3xs font-medium text-muted-foreground uppercase">
        {queuePosition(index)}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {from && <div className="text-3xs font-medium text-primary/80">{from}</div>}
        {draft === null ? (
          message.input.text && (
            <p className="line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
              {message.input.text}
            </p>
          )
        ) : (
          <div className="space-y-1.5">
            <Textarea
              autoFocus
              aria-label="Edit queued message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setDraft(null);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              }}
              className="min-h-16 text-xs"
            />
            <div className="flex gap-1.5">
              <Button size="xs" onClick={save} disabled={busy}>
                Save
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {message.input.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.input.attachments.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: attachments have no ids and never reorder.
              <Thumbnail key={i} attachment={a} />
            ))}
          </div>
        )}
      </div>
      {draft === null && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {canSteer && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Send now"
              title="Send now, into the running turn"
              disabled={busy}
              onClick={() => sendNow.mutate()}
            >
              <SendHorizontal />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Edit"
            title="Edit"
            disabled={busy}
            onClick={() => setDraft(message.input.text)}
          >
            <Pencil />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete"
            title="Delete"
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Messages waiting for the running turn to end, just above the composer: each with its
 * position, sender, text and thumbnails, and edit, delete and (when the provider can steer)
 * send-now actions. A delivered message leaves the tray and shows in the transcript.
 */
export function QueuedMessages({ session }: { session: Session }) {
  const { data: messages = [] } = useQueuedMessages(session.id);
  const canSteer = useSnapshotData(
    (s) => s.runner.providers.find((p) => p.id === session.provider)?.capabilities.steer ?? false,
    false,
  );
  if (messages.length === 0) return null;
  return (
    <section
      aria-label="Queued messages"
      data-testid="queued-messages"
      className="mx-auto w-full max-w-[46rem] px-6 pb-2"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card/70 shadow-xs animate-rise">
        <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-1.5 text-3xs text-muted-foreground">
          <ListOrdered className="size-3" />
          <span className="font-medium text-foreground/80">{messages.length} queued</span>
          <span>· sent one at a time when the current turn ends</span>
        </div>
        <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto scroll-thin">
          {messages.map((m, i) => (
            <QueuedRow key={m.id} session={session} message={m} index={i} canSteer={canSteer} />
          ))}
        </ul>
      </div>
    </section>
  );
}
