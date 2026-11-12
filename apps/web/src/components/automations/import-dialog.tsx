import {
  AUTOMATION_IMPORT_LIMITS,
  type AutomationImportPreviewItem,
  type AutomationImportSource,
} from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileUp, FolderGit2, Globe, Import } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AUTONOMY } from "@/components/thread/autonomy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useClient } from "@/lib/api";
import { automationKeys } from "@/lib/automations";
import { cn } from "@/lib/utils";
import { Segmented } from "./form-bits";
import { describeTrigger } from "./meta";

/** Read picked files into an import source: `.zip` as base64, anything else as text. */
export async function readImportFiles(files: File[]): Promise<AutomationImportSource> {
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  const texts = files.filter((f) => !/\.zip$/i.test(f.name));
  if (files.filter((f) => /\.zip$/i.test(f.name)).length > 1) {
    throw new Error("Pick one .zip at a time");
  }
  if (texts.length > AUTOMATION_IMPORT_LIMITS.maxFiles) {
    throw new Error(`At most ${AUTOMATION_IMPORT_LIMITS.maxFiles} files at once`);
  }
  for (const f of texts) {
    if (f.size > AUTOMATION_IMPORT_LIMITS.maxFileChars) throw new Error(`${f.name} is too large`);
  }
  if (zip && zip.size > AUTOMATION_IMPORT_LIMITS.maxZipBytes) {
    throw new Error(`${zip.name} is larger than ${AUTOMATION_IMPORT_LIMITS.maxZipBytes / 1024} KB`);
  }
  const source: AutomationImportSource = {};
  if (texts.length) {
    source.files = await Promise.all(
      texts.map(async (f) => ({ name: f.name, content: await f.text() })),
    );
  }
  if (zip) {
    const bytes = new Uint8Array(await zip.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    source.zipBase64 = btoa(bin);
  }
  return source;
}

/** The agent line of a preview: provider and model, or the default agent. */
function agentLine(item: AutomationImportPreviewItem): string {
  const a = item.automation?.action;
  if (!a) return "";
  if (a.type === "message_pm") return "Messages the PM";
  if (a.type === "triage") return "PM triage";
  return [a.provider ?? "Default agent", a.model, a.effort && `${a.effort} effort`]
    .filter(Boolean)
    .join(" · ");
}

function PreviewRow({
  item,
  checked,
  onCheck,
}: {
  item: AutomationImportPreviewItem;
  checked: boolean;
  onCheck: (v: boolean) => void;
}) {
  const a = item.automation;
  const action = a?.action;
  const level = action?.type === "start_session" ? (action.autonomy ?? "auto") : null;
  const text =
    action?.type === "start_session"
      ? action.prompt
      : action?.type === "message_pm"
        ? action.message
        : (action?.instructions ?? "");
  return (
    <label
      className={cn(
        "flex gap-3 border-b border-border px-3 py-2.5 last:border-0",
        a ? "cursor-pointer hover:bg-accent/30" : "bg-status-failed/[0.04]",
      )}
      data-testid="import-preview-row"
    >
      <input
        type="checkbox"
        className="mt-1 size-3.5 accent-[var(--primary)]"
        checked={checked}
        disabled={!a}
        onChange={(e) => onCheck(e.target.checked)}
        aria-label={`Import ${a?.name ?? item.fileName}`}
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{a?.name ?? item.fileName}</span>
          <code className="font-mono text-3xs text-muted-foreground">{item.fileName}</code>
        </span>
        {a ? (
          <>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              <span>{describeTrigger(a.trigger)}</span>
              <span>{agentLine(item)}</span>
              {level && (
                <span className="flex items-center gap-1">
                  {(() => {
                    const L = AUTONOMY[level];
                    return <L.icon className={cn("size-3", L.tone)} />;
                  })()}
                  {AUTONOMY[level].label}
                </span>
              )}
            </span>
            {text && (
              <span className="line-clamp-3 font-mono text-3xs leading-relaxed whitespace-pre-wrap text-muted-foreground/90">
                {text.split("\n").slice(0, 3).join("\n")}
              </span>
            )}
            {item.fullPermissions && (
              <span className="flex items-start gap-1.5 text-2xs text-status-waiting">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Full permissions: it never asks before acting. Check the prompt before you switch it
                on.
              </span>
            )}
          </>
        ) : (
          <span className="block text-2xs text-status-failed">{item.error}</span>
        )}
      </span>
    </label>
  );
}

/**
 * Import automations (§10): `.md` files, a `.zip` of them, or pasted Markdown. The server
 * parses them like automation files and previews each one; nothing runs, and imported
 * automations always start off.
 */
export function ImportDialog({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"files" | "paste">("files");
  const [text, setText] = useState("");
  const [source, setSource] = useState<AutomationImportSource | null>(null);
  const [items, setItems] = useState<AutomationImportPreviewItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<"project" | "all_projects">("project");
  const reset = () => {
    setSource(null);
    setItems(null);
    setSelected(new Set());
    setText("");
  };

  const preview = useMutation({
    mutationFn: async (src: AutomationImportSource) => ({
      src,
      res: await client.automations.previewImport(src),
    }),
    onSuccess: ({ src, res }) => {
      setSource(src);
      setItems(res.items);
      setSelected(new Set(res.items.filter((i) => i.automation).map((i) => i.fileName)));
    },
    onError: (e) => toast.error("Couldn't read the import", { description: e.message }),
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!source) throw new Error("Nothing to import");
      return client.automations.importAutomations({
        source,
        select: [...selected],
        ...(target === "project" ? { projectId } : {}),
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
      const n = res.created.length;
      toast.success(`Imported ${n} automation${n === 1 ? "" : "s"}, all off`, {
        description: res.failed.length ? `${res.failed.length} could not be imported` : undefined,
      });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error("Couldn't import", { description: e.message }),
  });

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      preview.mutate(await readImportFiles([...files]));
    } catch (e) {
      toast.error("Couldn't read the files", { description: (e as Error).message });
    }
  };
  const valid = items?.filter((i) => i.automation) ?? [];
  const fullSelected = items?.some((i) => i.fullPermissions && selected.has(i.fileName));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Import /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>Import automations</DialogTitle>
          <DialogDescription>
            Markdown automation files (<code>.md</code>), a <code>.zip</code> of them, or pasted
            text. Nothing runs, and everything you import starts off.
          </DialogDescription>
        </DialogHeader>
        {!items ? (
          <div className="space-y-3">
            <Segmented
              label="Import from"
              value={mode}
              onChange={setMode}
              options={[
                { id: "files", label: "Files" },
                { id: "paste", label: "Paste" },
              ]}
            />
            {mode === "files" ? (
              <label
                htmlFor={`${id}-files`}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center hover:border-primary/40"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void pick(e.dataTransfer.files);
                }}
              >
                <FileUp className="size-6 text-muted-foreground" />
                <span className="text-[13px] font-medium">Choose or drop .md files or a .zip</span>
                <span className="text-2xs text-muted-foreground">
                  Up to {AUTOMATION_IMPORT_LIMITS.maxFiles} automations,{" "}
                  {AUTOMATION_IMPORT_LIMITS.maxFileChars / 1024} KB each
                </span>
                <input
                  id={`${id}-files`}
                  type="file"
                  multiple
                  accept=".md,.markdown,.zip,text/markdown,application/zip"
                  className="sr-only"
                  data-testid="import-file-input"
                  onChange={(e) => void pick(e.target.files)}
                />
              </label>
            ) : (
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={
                  '---\nname: Release notes draft\ntrigger:\n  type: cron\n  expression: "0 16 * * 5"\n---\nDraft the release notes for {{project.name}}.'
                }
                className="font-mono text-[12px]"
                aria-label="Automation Markdown"
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="max-h-[50vh] overflow-y-auto rounded-xl border border-border scroll-thin"
              data-testid="import-preview"
            >
              {items.map((item) => (
                <PreviewRow
                  key={item.fileName}
                  item={item}
                  checked={selected.has(item.fileName)}
                  onCheck={(v) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (v) next.add(item.fileName);
                      else next.delete(item.fileName);
                      return next;
                    })
                  }
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-muted-foreground">Import into</span>
              <Segmented
                label="Import into"
                value={target}
                onChange={setTarget}
                options={[
                  { id: "project", label: "This project", icon: <FolderGit2 /> },
                  { id: "all_projects", label: "All projects", icon: <Globe /> },
                ]}
              />
            </div>
            {fullSelected && (
              <p className="flex items-start gap-1.5 rounded-lg border border-status-waiting/30 bg-status-waiting/[0.06] px-3 py-2 text-2xs text-status-waiting">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Some selected automations use Full permissions and would act without asking. They
                start off; review them before switching them on.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {items ? (
            <>
              <Button variant="ghost" onClick={reset}>
                Back
              </Button>
              <Button
                onClick={() => commit.mutate()}
                disabled={selected.size === 0 || commit.isPending}
              >
                Import {selected.size} of {valid.length}, off
              </Button>
            </>
          ) : (
            mode === "paste" && (
              <Button
                onClick={() => preview.mutate({ text })}
                disabled={!text.trim() || preview.isPending}
              >
                Preview
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
