import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Plus, RefreshCw, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";
import { automationKeys, useAutomations, useProjectAutomationSettings } from "@/lib/automations";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { AutomationRow } from "./automation-row";
import { RunConflictCard } from "./run-conflict";
import { useAutomationActions } from "./use-automation-actions";

/** The global switch, this project's switch and a reload of automation files. */
export function AutomationSwitches({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const globalOn = useSnapshotData((s) => s.settings.automations.enabled, false);
  const settings = useProjectAutomationSettings(projectId);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: automationKeys.all });
  const setGlobal = useMutation({
    mutationFn: (enabled: boolean) => client.updateSettings({ automations: { enabled } }),
    onSuccess: (_d, on) => toast.success(on ? "Automations on" : "All automations paused"),
  });
  const setProject = useMutation({
    mutationFn: (enabled: boolean) => client.automations.setProjectEnabled(projectId, enabled),
    onSuccess: refresh,
  });
  const reload = useMutation({
    mutationFn: () => client.automations.reload(),
    onSuccess: (res) => {
      toast.success("Automation files re-read", {
        description: res.errors.length ? `${res.errors.length} file(s) have errors` : undefined,
      });
      refresh();
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      <div className="flex items-center gap-2">
        <Switch
          checked={globalOn}
          onCheckedChange={(v) => setGlobal.mutate(v)}
          aria-label="Automations on globally"
        />
        <span>All projects</span>
      </div>
      <div className={cn("flex items-center gap-2", !globalOn && "opacity-60")}>
        <Switch
          checked={settings.data?.enabled ?? true}
          onCheckedChange={(v) => setProject.mutate(v)}
          aria-label="Automations on for this project"
        />
        <span>This project</span>
      </div>
      <Button
        size="xs"
        variant="ghost"
        className="ml-auto text-muted-foreground"
        onClick={() => reload.mutate()}
        disabled={reload.isPending}
      >
        <RefreshCw className={cn(reload.isPending && "animate-spin")} /> Reload files
      </Button>
    </div>
  );
}

/**
 * A project's automations with their switches, run now and schedule state (§10). `compact`
 * is the project-home card: no switches header, links to the full page.
 */
export function AutomationsPanel({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAutomations(projectId);
  const actions = useAutomationActions(projectId);
  const starter = useMutation({
    mutationFn: () => client.automations.starterSet(projectId, false),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationKeys.all }),
  });
  const items = data?.automations ?? [];
  const sorted = [...items].sort(
    (a, b) =>
      Number(b.states[0]?.enabled ?? false) - Number(a.states[0]?.enabled ?? false) ||
      a.automation.name.localeCompare(b.automation.name),
  );

  return (
    <div className="space-y-3">
      {!compact && <AutomationSwitches projectId={projectId} />}
      {data?.errors.map((e) => (
        <div
          key={e.path}
          className="flex items-start gap-2 rounded-lg border border-status-failed/30 bg-status-failed/5 px-3 py-2 text-2xs"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-status-failed" />
          <span className="min-w-0">
            <code className="font-mono">{e.path}</code>
            <span className="block text-muted-foreground">{e.message}</span>
          </span>
        </div>
      ))}
      {actions.conflict && (
        <RunConflictCard
          conflict={actions.conflict}
          projectId={projectId}
          onClose={() => actions.setConflict(null)}
        />
      )}
      {!isLoading && items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <EmptyState
            icon={<Workflow />}
            title="No automations yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" asChild>
                  <Link to="/projects/$projectId/automations/new" params={{ projectId }}>
                    <Plus /> New automation
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => starter.mutate()}
                  disabled={starter.isPending}
                >
                  <Sparkles /> Add the starter set
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/projects/$projectId/automations"
                    params={{ projectId }}
                    search={{ tab: "templates" }}
                  >
                    Browse templates
                  </Link>
                </Button>
              </div>
            }
          >
            Scheduled audits, dependency updates, triage and more. Everything starts off.
          </EmptyState>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          data-testid="automations-list"
        >
          {sorted.map((item) => (
            <AutomationRow
              key={item.automation.id}
              item={item}
              projectId={projectId}
              actions={actions}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}
