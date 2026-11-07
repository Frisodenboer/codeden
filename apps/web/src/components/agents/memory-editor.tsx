import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileText, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProviderMark } from "@/components/common/bits";
import { CodeEditor } from "@/components/editor/code-editor";
import { SaveDiffDialog } from "@/components/editor/save-diff-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import type { MemoryFile } from "@/lib/api/types";
import { ageShort } from "@/lib/format";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";

const scopeTone = { global: "text-chart-2", project: "text-primary", local: "text-chart-4" };

/** Memory files of every provider, edited in place with a diff preview (§12.4). */
export function MemoryEditor({ projectId }: { projectId: string | null }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const files = useQuery({
    queryKey: ["memory", projectId],
    queryFn: () => client.listMemoryFiles(projectId),
  });
  const [selected, setSelected] = useState<MemoryFile | null>(null);
  const current =
    selected ?? files.data?.find((f) => f.path === "CLAUDE.md") ?? files.data?.[0] ?? null;
  const contents = useQuery({
    queryKey: ["config-file", current?.path],
    queryFn: () => client.readConfigFile(current?.path ?? ""),
    enabled: Boolean(current),
  });
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState(false);
  useEffect(() => setDraft(contents.data ?? ""), [contents.data]);
  const save = useMutation({
    mutationFn: () => client.writeConfigFile(current?.path ?? "", draft),
    onSuccess: () => {
      queryClient.setQueryData(["config-file", current?.path], draft);
      setReview(false);
      toast.success(`Saved ${current?.path}`, {
        description: "Backup written · picked up by new sessions and the CLI",
      });
    },
  });
  const dirty = contents.data !== undefined && draft !== contents.data;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-border p-2 scroll-thin">
        {files.isLoading && (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}
        {providers.map((p) => {
          const list = files.data?.filter((f) => f.provider === p.id) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={p.id} className="mb-3">
              <div className="flex items-center gap-2 px-2 py-1.5 text-2xs font-medium text-muted-foreground">
                <ProviderMark provider={p.id} /> {p.displayName}
              </div>
              {list.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected(f)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60",
                    current?.id === f.id && "bg-accent",
                  )}
                >
                  {f.exists ? (
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FilePlus2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13px]",
                        !f.exists && "text-muted-foreground",
                      )}
                    >
                      {f.label}
                    </span>
                    <span className="block truncate font-mono text-3xs text-muted-foreground">
                      {f.path}
                    </span>
                  </span>
                  <span className={cn("mt-0.5 text-3xs capitalize", scopeTone[f.scope])}>
                    {f.scope}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <code className="truncate font-mono text-xs">{current?.path}</code>
          {current && !current.exists && (
            <span className="rounded bg-muted px-1.5 text-3xs text-muted-foreground">new file</span>
          )}
          {dirty && (
            <span className="size-1.5 rounded-full bg-status-waiting" title="Unsaved changes" />
          )}
          <span className="ml-auto text-3xs text-muted-foreground">
            {current?.updatedAt ? `edited ${ageShort(current.updatedAt)} ago` : ""}
          </span>
          <Button
            size="xs"
            variant="ghost"
            disabled={!dirty}
            onClick={() => setDraft(contents.data ?? "")}
          >
            <RotateCcw /> Revert
          </Button>
          <Button size="xs" disabled={!dirty} onClick={() => setReview(true)}>
            <Save /> Review & save
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          {current && contents.data !== undefined ? (
            <CodeEditor
              docKey={`${current.path}-${contents.dataUpdatedAt}`}
              path={current.path}
              value={draft}
              onChange={setDraft}
              onSave={() => dirty && setReview(true)}
              placeholder="Write instructions every session should follow…"
            />
          ) : (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${70 - i * 15}%` }} />
              ))}
            </div>
          )}
        </div>
      </div>
      {current && (
        <SaveDiffDialog
          open={review}
          onOpenChange={setReview}
          path={current.path}
          before={contents.data ?? ""}
          after={draft}
          onConfirm={() => save.mutate()}
          saving={save.isPending}
        />
      )}
    </div>
  );
}
