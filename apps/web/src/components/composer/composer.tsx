import type { Attachment, Session } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, ListPlus, Paperclip, Square, Zap } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type SendMode, useClient } from "@/lib/api";
import { useSnapshotData } from "@/lib/queries";
import { matchesCombo, shortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import {
  type ComposerAttachment,
  getDraft,
  type TurnOptions,
  useComposerStore,
} from "@/stores/composer";
import { AttachmentStrip, filesToAttachments } from "./attachments";
import { AutonomyPicker, EffortPicker, ModelPicker } from "./pickers";
import { SuggestionMenu } from "./suggestion-menu";
import { applyTrigger } from "./trigger";
import { useSuggestions } from "./use-suggestions";
import { VoiceButton } from "./voice-button";

function toInput(attachments: ComposerAttachment[]): Attachment[] {
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

const placeholders: Record<Session["role"], string> = {
  orchestrator: "Ask the orchestrator to start a project, triage issues or check on work…",
  pm: "Message the project manager…",
  agent: "Message the agent — @ to mention files, / for commands and skills",
};

/** Composer (§13): text, attachments, mentions, commands, pickers, queue/steer, stop, voice. */
export function Composer({ session, running }: { session: Session; running: boolean }) {
  const client = useClient();
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const dictationLanguage = useSnapshotData((s) => s.settings.voice.dictation.language, null);
  const draft = useComposerStore((s) => getDraft(s, session.id));
  const stored = useComposerStore((s) => s.options[session.id]);
  const focusToken = useComposerStore((s) => s.focusToken);
  const { setText, addAttachments, removeAttachment, clear, setOptions } =
    useComposerStore.getState();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<Exclude<SendMode, "send">>("queue");

  const fallback: TurnOptions = {
    provider: session.provider,
    model: session.model,
    effort: session.effort,
    autonomy: session.autonomy,
  };
  const options = stored ?? fallback;
  const provider = providers.find((p) => p.id === options.provider);
  const model =
    provider?.models.find((m) => m.id === options.model) ??
    provider?.models.find((m) => m.isDefault);
  const canSteer = provider?.capabilities.steer ?? false;
  const suggestions = useSuggestions(session.id, draft.text, caret);

  useEffect(() => {
    if (focusToken > 0) {
      ref.current?.focus();
      const end = ref.current?.value.length ?? 0;
      ref.current?.setSelectionRange(end, end);
    }
  }, [focusToken]);

  const send = useMutation({
    mutationFn: (sendMode: SendMode) =>
      client.sendMessage(
        session.id,
        { text: draft.text.trim(), attachments: toInput(draft.attachments) },
        sendMode,
      ),
    onMutate: () => clear(session.id),
    onSuccess: (_d, sendMode) => {
      if (sendMode === "queue")
        toast("Queued", { description: "Sends when the current turn finishes." });
      if (sendMode === "steer") toast("Sent to the running turn");
    },
    onError: (e) => toast.error("Message not sent", { description: e.message }),
  });
  const stop = useMutation({ mutationFn: () => client.interrupt(session.id) });

  const canSend = draft.text.trim().length > 0 || draft.attachments.length > 0;
  const submit = (override?: SendMode) => {
    if (!canSend) return;
    send.mutate(override ?? (running ? (canSteer ? mode : "queue") : "send"));
  };

  const pick = (insert: string) => {
    if (!suggestions.trigger) return;
    const next = applyTrigger(draft.text, caret, suggestions.trigger, insert);
    setText(session.id, next.text);
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.open && suggestions.items.length > 0) {
      const n = suggestions.items.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        suggestions.setActive((suggestions.active + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        suggestions.setActive((suggestions.active - 1 + n) % n);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions.items[suggestions.active];
        if (s) pick(s.insert);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        suggestions.dismiss();
        return;
      }
    }
    if (matchesCombo(e.nativeEvent, shortcut("stop").combo) && running) {
      e.preventDefault();
      stop.mutate();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(running && canSteer && (e.ctrlKey || e.metaKey) ? "steer" : undefined);
    }
  };

  const onPaste = async (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    addAttachments(session.id, await filesToAttachments(files));
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addAttachments(session.id, await filesToAttachments(Array.from(e.dataTransfer.files)));
  };
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-5">
      <div className="relative">
        {suggestions.open && (
          <SuggestionMenu
            title={suggestions.title}
            items={suggestions.items}
            active={suggestions.active}
            onHover={suggestions.setActive}
            onPick={(s) => pick(s.insert)}
          />
        )}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone for files; the textarea and attach button stay keyboard accessible. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-2xl border border-border bg-card shadow-[0_10px_30px_-18px] shadow-black/40 transition-[border-color,box-shadow] focus-within:border-primary/35 focus-within:shadow-[0_0_0_4px] focus-within:shadow-primary/[0.07]",
            dragging && "border-dashed border-primary/60 bg-primary/[0.03]",
          )}
        >
          <AttachmentStrip
            items={draft.attachments}
            onRemove={(id) => removeAttachment(session.id, id)}
          />
          <textarea
            ref={ref}
            value={draft.text}
            rows={1}
            onChange={(e) => {
              setText(session.id, e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={
              running ? "Queue a follow-up, or steer the running turn…" : placeholders[session.role]
            }
            aria-label="Message"
            className="block max-h-64 min-h-[56px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center gap-0.5 px-2 pb-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={async (e) =>
                addAttachments(
                  session.id,
                  await filesToAttachments(Array.from(e.target.files ?? [])),
                )
              }
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={() => fileInput.current?.click()}
                  aria-label="Attach files"
                >
                  <Paperclip />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach files or paste an image</TooltipContent>
            </Tooltip>
            <ModelPicker
              providers={providers}
              provider={options.provider}
              model={model?.id ?? null}
              onChange={(p, m) => setOptions(session.id, { provider: p, model: m }, fallback)}
            />
            {provider?.capabilities.reasoningEffort && (
              <EffortPicker
                efforts={model?.efforts ?? []}
                value={options.effort ?? model?.defaultEffort ?? null}
                onChange={(effort) => setOptions(session.id, { effort }, fallback)}
              />
            )}
            {session.role === "agent" && (
              <AutonomyPicker
                value={options.autonomy}
                onChange={(autonomy) => setOptions(session.id, { autonomy }, fallback)}
              />
            )}
            <div className="ml-auto flex items-center gap-1">
              {running && canSteer && (
                <div
                  className="mr-1 flex h-7 items-center rounded-lg border border-border p-0.5 text-2xs"
                  title="While a turn runs"
                >
                  {(["queue", "steer"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                      className={cn(
                        "flex h-full items-center gap-1 rounded-md px-2 capitalize text-muted-foreground transition-colors",
                        mode === m && "bg-accent text-foreground",
                      )}
                    >
                      {m === "queue" ? <ListPlus className="size-3" /> : <Zap className="size-3" />}
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <VoiceButton
                baseText={draft.text}
                onText={(t) => setText(session.id, t)}
                language={dictationLanguage}
              />
              {running && !canSend ? (
                <Button
                  size="icon-sm"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => stop.mutate()}
                  aria-label="Stop"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  className="rounded-full transition-transform hover:scale-105"
                  onClick={() => submit()}
                  disabled={!canSend || send.isPending}
                  aria-label={running ? (canSteer ? `${mode} message` : "Queue message") : "Send"}
                >
                  {running ? mode === "steer" && canSteer ? <Zap /> : <ListPlus /> : <ArrowUp />}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
