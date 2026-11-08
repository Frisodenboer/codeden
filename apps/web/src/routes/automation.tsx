import type { AutonomyLevel } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Save, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AutomationForm } from "@/components/automations/automation-form";
import { DetailActions, OriginBadges } from "@/components/automations/detail-actions";
import {
  type AutomationDraft,
  draftFromAutomation,
  draftProblems,
  toUpdateRequest,
} from "@/components/automations/draft";
import { ExportMenu } from "@/components/automations/export-menu";
import { ACTION_LABEL, describeTrigger } from "@/components/automations/meta";
import { RunConflictCard } from "@/components/automations/run-conflict";
import { RunsTable } from "@/components/automations/runs-table";
import { ScheduleCard } from "@/components/automations/schedule-card";
import { useAutomationActions } from "@/components/automations/use-automation-actions";
import { SectionLabel } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { automationKeys, useAutomation } from "@/lib/automations";
import { localTimezone } from "@/lib/cron";
import { useProject, useSnapshotData } from "@/lib/queries";
import { PageHeader } from "./page-header";

/**
 * Automation detail (§10): the same editor as New automation, always editable for automations
 * stored in CodeDen; file-based ones are read-only with "Duplicate to edit". Export, duplicate
 * and delete, the schedule and recent runs.
 */
export function AutomationPage({
  projectId,
  automationId,
}: {
  projectId: string;
  automationId: string;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const project = useProject(projectId);
  const defaultAutonomy = useSnapshotData<AutonomyLevel>(
    (s) => s.settings.autonomy.default,
    "auto",
  );
  const { data: item, isLoading, error } = useAutomation(automationId);
  const actions = useAutomationActions(projectId);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const savedAt = item?.automation.updatedAt;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the draft when the saved version changes.
  useEffect(() => {
    if (item) setDraft(draftFromAutomation(item.automation));
  }, [savedAt, automationId]);

  const save = useMutation({
    mutationFn: (d: AutomationDraft) =>
      client.automations.update(automationId, toUpdateRequest(d, projectId)),
    onSuccess: () => {
      toast.success("Automation saved");
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });

  if (error) {
    return <div className="p-8 text-sm text-muted-foreground">{error.message}</div>;
  }
  if (isLoading || !item || !draft || !project) {
    return <Skeleton className="m-6 h-64 rounded-xl" />;
  }
  const a = item.automation;
  const readOnly = item.readOnly;
  const tz = project.timezone ?? localTimezone();
  const dirty = JSON.stringify(draftFromAutomation(a)) !== JSON.stringify(draft);
  const problems = draftProblems(draft, tz);

  return (
    <>
      <PageHeader
        icon={<Workflow />}
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <Link
              to="/projects/$projectId/automations"
              params={{ projectId }}
              className="flex items-center text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" /> {project.name}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate">{a.name}</span>
            <OriginBadges item={item} />
          </span>
        }
        meta={`${describeTrigger(a.trigger)} · ${ACTION_LABEL[a.action.type]}`}
        actions={
          <>
            <DetailActions item={item} projectId={projectId} />
            <ExportMenu automationId={a.id} />
            {!readOnly && (
              <>
                {dirty && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft(draftFromAutomation(a))}
                  >
                    Revert
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!dirty || problems.length > 0 || save.isPending}
                  title={problems.join(" ")}
                  onClick={() => save.mutate(draft)}
                >
                  <Save /> {save.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            {readOnly && (
              <p className="rounded-lg border border-border bg-surface px-3 py-2 text-2xs text-muted-foreground">
                This automation comes from{" "}
                <code className="font-mono">{item.path ?? "a built-in template"}</code>. Edit the
                file, or use <span className="font-medium text-foreground">Duplicate to edit</span>{" "}
                for a copy you can change here.
              </p>
            )}
            {a.createdBy === "pm" && (
              <p className="rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-2xs text-muted-foreground">
                Created by the PM. It stays off until you switch it on; check the prompt and
                permissions first.
              </p>
            )}
            <AutomationForm
              draft={draft}
              onChange={setDraft}
              disabled={readOnly}
              projectTimezone={tz}
              defaultAutonomy={defaultAutonomy}
              docKey={`${a.id}:${savedAt}`}
              defaultWorkKey={`automation:${a.templateId ?? "name"}`}
            />
          </div>
          <aside className="space-y-4">
            <ScheduleCard item={item} projectId={projectId} actions={actions} />
            {actions.conflict && (
              <RunConflictCard
                conflict={actions.conflict}
                projectId={projectId}
                onClose={() => actions.setConflict(null)}
              />
            )}
            <div>
              <SectionLabel className="mb-2">Recent runs</SectionLabel>
              <RunsTable projectId={projectId} automationId={a.id} limit={20} />
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
