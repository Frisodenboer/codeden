import { ChevronRight, Workflow } from "lucide-react";
import { useState } from "react";
import { useAutomationActions } from "@/components/automations/use-automation-actions";
import { StatusDot } from "@/components/common/status-dot";
import { Switch } from "@/components/ui/switch";
import { stateIn, switchValue, useAutomations } from "@/lib/automations";
import { cn } from "@/lib/utils";
import { NavRow } from "./nav-row";

/**
 * A project's automations in the sidebar (§13): the Automations page link with how many are
 * on, and expandable rows with their switches.
 */
export function ProjectAutomations({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useAutomations(projectId);
  const actions = useAutomationActions(projectId);
  const items = data?.automations ?? [];
  const on = items.filter((i) => stateIn(i, projectId)?.enabled).length;
  return (
    <>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex size-6 shrink-0 items-center justify-center pl-3 text-muted-foreground"
          aria-label={open ? "Hide automations" : "Show automations"}
          aria-expanded={open}
        >
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        </button>
        <NavRow
          href={`/projects/${projectId}/automations`}
          link={{ to: "/projects/$projectId/automations", params: { projectId } }}
          className="h-7 pl-1.5 text-xs text-muted-foreground"
          exact={false}
        >
          <Workflow className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">Automations</span>
          <span className="text-3xs tabular-nums" data-testid="sidebar-automations-on">
            {on} on
          </span>
        </NavRow>
      </div>
      {open &&
        items.map((item) => {
          const state = stateIn(item, projectId);
          return (
            <div key={item.automation.id} className="flex h-7 items-center gap-1 pr-2 pl-8">
              <NavRow
                href={`/projects/${projectId}/automations/${item.automation.id}`}
                link={{
                  to: "/projects/$projectId/automations/$automationId",
                  params: { projectId, automationId: item.automation.id },
                }}
                className="h-6 min-w-0 flex-1 px-1 text-xs"
              >
                <StatusDot tone={state?.paused ? "waiting" : state?.enabled ? "done" : "idle"} />
                <span className={cn("truncate", !state?.enabled && "text-sidebar-foreground/55")}>
                  {item.automation.name}
                </span>
              </NavRow>
              <Switch
                size="sm"
                checked={switchValue(item, projectId)}
                onCheckedChange={(enabled) => actions.toggle.mutate({ item, enabled })}
                aria-label={`Enable ${item.automation.name}`}
              />
            </div>
          );
        })}
    </>
  );
}
