import type { Automation, UpdateAutomationRequest } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Lock, Save, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionEditor } from "@/components/automations/action-editor";
import { EditorSection, Field } from "@/components/automations/form-bits";
import { GuardsEditor } from "@/components/automations/guards-editor";
import { ACTION_LABEL, describeTrigger } from "@/components/automations/meta";
import { RunConflictCard } from "@/components/automations/run-conflict";
import { RunsTable } from "@/components/automations/runs-table";
import { ScheduleCard } from "@/components/automations/schedule-card";
import { TriggerEditor } from "@/components/automations/trigger-editor";
import { useAutomationActions } from "@/components/automations/use-automation-actions";
import { SectionLabel } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { automationKeys, useAutomation } from "@/lib/automations";
import { cronError, localTimezone } from "@/lib/cron";
import { useProject } from "@/lib/queries";
import { PageHeader } from "./page-header";

type Draft = Pick<Automation, "name" | "description" | "trigger" | "action" | "guards" | "workKey">;

const draftOf = (a: Automation): Draft => ({
  name: a.name,
  description: a.description,
  trigger: a.trigger,
  action: a.action,
  guards: a.guards,
  workKey: a.workKey,
});

/** Automation detail (§10): trigger, action, guards and prompt editor, schedule and runs. */
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
  const { data: item, isLoading, error } = useAutomation(automationId);
  const actions = useAutomationActions(projectId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const savedAt = item?.automation.updatedAt;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the draft when the saved version changes.
  useEffect(() => {
    if (item) setDraft(draftOf(item.automation));
  }, [savedAt, automationId]);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const req: UpdateAutomationRequest = {
        name: d.name,
        description: d.description,
        trigger: d.trigger,
        action: d.action,
        guards: d.guards,
        workKey: d.workKey ?? null,
      };
      return client.automations.update(automationId, req);
    },
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
  const dirty = JSON.stringify(draftOf(a)) !== JSON.stringify(draft);
  const invalid =
    !draft.name.trim() ||
    (draft.trigger.type === "cron" && cronError(draft.trigger.expression, tz) !== null);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <>
      <PageHeader
        icon={<Workflow />}
        title={
          <span className="flex items-center gap-1.5">
            <Link
              to="/projects/$projectId/automations"
              params={{ projectId }}
              className="flex items-center text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" /> {project.name}
            </Link>
            <span className="text-muted-foreground">/</span> {a.name}
          </span>
        }
        meta={`${describeTrigger(a.trigger)} · ${ACTION_LABEL[a.action.type]}`}
        actions={
          readOnly ? (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Lock className="size-3" /> Read-only (file)
            </span>
          ) : (
            <>
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(draftOf(a))}>
                  Revert
                </Button>
              )}
              <Button
                size="sm"
                disabled={!dirty || invalid || save.isPending}
                onClick={() => save.mutate(draft)}
              >
                <Save /> {save.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5" data-testid="automation-editor">
            <EditorSection title="Basics">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="auto-name">
                  <Input
                    id="auto-name"
                    value={draft.name}
                    disabled={readOnly}
                    onChange={(e) => set({ name: e.target.value })}
                    className="text-[13px]"
                  />
                </Field>
                <Field
                  label="Work key"
                  htmlFor="auto-key"
                  help="Runs with the same key are treated as the same work (§8.4)."
                >
                  <Input
                    id="auto-key"
                    value={draft.workKey ?? ""}
                    placeholder={`automation:${a.templateId ?? "name"}`}
                    disabled={readOnly}
                    onChange={(e) => set({ workKey: e.target.value.trim() || undefined })}
                    className="font-mono text-[13px]"
                  />
                </Field>
              </div>
              <Field label="Description" htmlFor="auto-desc">
                <Input
                  id="auto-desc"
                  value={draft.description ?? ""}
                  disabled={readOnly}
                  onChange={(e) => set({ description: e.target.value || null })}
                  className="text-[13px]"
                />
              </Field>
            </EditorSection>
            <EditorSection title="Trigger" description="When it runs.">
              <TriggerEditor
                trigger={draft.trigger}
                onChange={(trigger) => set({ trigger })}
                disabled={readOnly}
                projectTimezone={tz}
                allowCron={draft.action.type !== "triage"}
              />
            </EditorSection>
            <EditorSection title="Action" description="What a run does.">
              <ActionEditor
                action={draft.action}
                onChange={(action) => set({ action })}
                disabled={readOnly}
                docKey={`${a.id}:${savedAt}`}
              />
            </EditorSection>
            <EditorSection title="Guards" description="Safety rails on every run.">
              <GuardsEditor
                guards={draft.guards}
                onChange={(guards) => set({ guards })}
                disabled={readOnly}
                projectTimezone={tz}
              />
            </EditorSection>
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
