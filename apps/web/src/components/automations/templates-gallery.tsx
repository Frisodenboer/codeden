import type { AutomationTemplate } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, FileCode2, GitBranch, Pencil, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { automationKeys, useAutomations, useAutomationTemplates } from "@/lib/automations";
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { triggerIcon } from "./automation-row";
import { ACTION_LABEL, describeTrigger, OVERLAP_LABEL } from "./meta";

function TemplateCard({
  template,
  added,
  unavailable,
  onAdd,
  busy,
  projectId,
}: {
  template: AutomationTemplate;
  added: boolean;
  unavailable: boolean;
  onAdd: (enable: boolean) => void;
  busy: boolean;
  projectId: string;
}) {
  const Icon = triggerIcon[template.trigger.type];
  return (
    <div
      className="flex flex-col rounded-xl border border-border bg-card p-4"
      data-testid="template-card"
      data-template={template.id}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium">{template.name}</h3>
          <p className="text-3xs text-muted-foreground">{describeTrigger(template.trigger)}</p>
        </div>
        {template.starter && (
          <span className="rounded-full bg-primary/10 px-1.5 py-px text-3xs font-medium text-primary">
            Starter
          </span>
        )}
      </div>
      <p className="mt-2.5 line-clamp-3 flex-1 text-2xs leading-relaxed text-muted-foreground">
        {template.description}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-3xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-px">{ACTION_LABEL[template.action.type]}</span>
        <span className="rounded bg-muted px-1.5 py-px">
          {OVERLAP_LABEL[template.guards.overlapPolicy]}
        </span>
        {template.requiresGithub && (
          <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-px">
            <GitBranch className="size-3" /> GitHub
          </span>
        )}
        {template.source === "global_file" && template.path && (
          <span className="flex items-center gap-1 truncate font-mono" title={template.path}>
            <FileCode2 className="size-3" /> {template.path.split(/[\\/]/).at(-1)}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3">
        {unavailable ? (
          <span className="text-2xs text-muted-foreground">Needs a GitHub project</span>
        ) : (
          <>
            <Button size="xs" asChild>
              <Link
                to="/projects/$projectId/automations/new"
                params={{ projectId }}
                search={{ template: template.id }}
              >
                <Pencil /> Use template
              </Link>
            </Button>
            {added ? (
              <span className="flex items-center gap-1 text-2xs text-status-done">
                <Check className="size-3.5" /> In this project
              </span>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => onAdd(true)} disabled={busy}>
                <Plus /> Add and enable
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Built-in and global templates (§10): add one to the project, or the whole starter set. */
export function TemplatesGallery({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const templates = useAutomationTemplates();
  const { data } = useAutomations(projectId);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: automationKeys.all });
  const added = new Set(
    (data?.automations ?? [])
      .filter((i) => i.automation.target.type === "project")
      .map((i) => i.automation.templateId),
  );
  const add = useMutation({
    mutationFn: (v: { template: AutomationTemplate; enable: boolean }) =>
      client.automations.create({ templateId: v.template.id, projectId, enabled: v.enable }),
    onSuccess: (item, v) => {
      refresh();
      toast.success(`${v.template.name} added${v.enable ? " and on" : ""}`, {
        action: {
          label: "Edit",
          onClick: () =>
            void navigate({
              to: "/projects/$projectId/automations/$automationId",
              params: { projectId, automationId: item.automation.id },
            }),
        },
      });
    },
    onError: (e) => toast.error("Couldn't add the automation", { description: e.message }),
  });
  const starter = useMutation({
    mutationFn: () => client.automations.starterSet(projectId, true),
    onSuccess: (res) => {
      refresh();
      toast.success(`Starter set on: ${res.automations.length} automations`);
    },
    onError: (e) => toast.error("Couldn't enable the starter set", { description: e.message }),
  });
  const isGithub = project?.kind === "github";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3">
        <Sparkles className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Starter set</p>
          <p className="text-2xs text-muted-foreground">
            The templates marked Starter that fit this project, switched on together. You can turn
            each one off again.
          </p>
        </div>
        <Button size="sm" onClick={() => starter.mutate()} disabled={starter.isPending}>
          Enable starter set
        </Button>
      </div>
      <div
        className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3")}
        data-testid="templates-gallery"
      >
        {templates.isLoading &&
          Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional.
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        {templates.data?.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            added={added.has(t.id)}
            unavailable={t.requiresGithub && !isGithub}
            busy={add.isPending}
            projectId={projectId}
            onAdd={(enable) => add.mutate({ template: t, enable })}
          />
        ))}
      </div>
    </div>
  );
}
