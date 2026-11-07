import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/editor/code-editor";
import { SaveDiffDialog } from "@/components/editor/save-diff-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { useProject } from "@/lib/queries";
import { PageHeader } from "./page-header";

const SECTIONS = [
  "Goals",
  "Target users",
  "Principles",
  "Out of scope",
  "Quality bar",
  "Protected areas",
];

/** Vision editor (§10.1): required for autopilot and dark-factory modes. */
export function VisionPage({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const project = useProject(projectId);
  const { data } = useQuery({
    queryKey: ["vision", projectId],
    queryFn: () => client.readVision(projectId),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  useEffect(() => setDraft(data ?? null), [data]);
  const save = useMutation({
    mutationFn: () => client.writeVision(projectId, draft ?? ""),
    onSuccess: () => {
      setReview(false);
      queryClient.setQueryData(["vision", projectId], draft);
      toast.success("Vision saved", { description: project?.visionPath });
    },
  });
  const dirty = draft !== null && draft !== data;
  const missing = SECTIONS.filter(
    (s) => !(draft ?? "").toLowerCase().includes(`## ${s.toLowerCase()}`),
  );

  return (
    <>
      <PageHeader
        icon={<Target />}
        title={`${project?.name ?? "Project"} vision`}
        meta={<code className="font-mono">{project?.visionPath}</code>}
        actions={
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/projects/$projectId" params={{ projectId }}>
                <ChevronLeft /> Project
              </Link>
            </Button>
            <Button size="sm" disabled={!dirty} onClick={() => setReview(true)}>
              Review & save
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          {draft === null ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <CodeEditor
              docKey={`vision-${projectId}-${data?.length ?? 0}`}
              value={draft}
              onChange={setDraft}
              onSave={() => dirty && setReview(true)}
            />
          )}
        </div>
        <aside className="hidden w-72 shrink-0 space-y-4 p-5 text-[13px] lg:block">
          <p className="text-muted-foreground">
            The PM scores every candidate against this file. Keep it short and concrete.
          </p>
          <div className="space-y-1">
            {SECTIONS.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={
                    missing.includes(s)
                      ? "size-1.5 rounded-full bg-status-waiting"
                      : "size-1.5 rounded-full bg-status-done"
                  }
                />
                <span className={missing.includes(s) ? "text-muted-foreground" : ""}>{s}</span>
              </div>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            Protected areas always escalate to you, whatever the autonomy mode.
          </p>
        </aside>
      </div>
      <SaveDiffDialog
        open={review}
        onOpenChange={setReview}
        path={project?.visionPath ?? "VISION.md"}
        before={data ?? ""}
        after={draft ?? ""}
        onConfirm={() => save.mutate()}
        saving={save.isPending}
      />
    </>
  );
}
