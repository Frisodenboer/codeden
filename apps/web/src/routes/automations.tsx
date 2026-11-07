import { useNavigate } from "@tanstack/react-router";
import { Workflow } from "lucide-react";
import { AutomationsPanel } from "@/components/automations/automations-panel";
import { RunsTable } from "@/components/automations/runs-table";
import { TemplatesGallery } from "@/components/automations/templates-gallery";
import { SectionLabel } from "@/components/common/bits";
import { NextRuns } from "@/components/project/now-next";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { useAutomations } from "@/lib/automations";
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";

export type AutomationsTab = "automations" | "runs" | "templates";

const TABS: { id: AutomationsTab; label: string }[] = [
  { id: "automations", label: "Automations" },
  { id: "runs", label: "Runs" },
  { id: "templates", label: "Templates" },
];

/** A project's automations (§10): the list with switches, runs history and templates. */
export function AutomationsPage({ projectId, tab }: { projectId: string; tab: AutomationsTab }) {
  const project = useProject(projectId);
  const navigate = useNavigate();
  const { data } = useAutomations(projectId);
  if (!project) return null;
  const on = data?.automations.filter((i) => i.states[0]?.enabled).length ?? 0;
  const go = (t: AutomationsTab) =>
    void navigate({
      to: "/projects/$projectId/automations",
      params: { projectId },
      search: t === "automations" ? {} : { tab: t },
      replace: true,
    });

  return (
    <>
      <PageHeader
        icon={<ProjectTile project={project} className="size-5 text-2xs" />}
        title={
          <span className="flex items-center gap-1.5">
            {project.name} <span className="text-muted-foreground">/</span>
            <Workflow className="size-3.5 text-muted-foreground" /> Automations
          </span>
        }
        meta={`${on} of ${data?.automations.length ?? 0} on`}
      />
      <div
        className="flex h-10 shrink-0 items-end gap-4 border-b border-border px-6"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={cn(
              "-mb-px border-b-2 border-transparent pb-2 text-[13px] text-muted-foreground hover:text-foreground",
              tab === t.id && "border-primary text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          {tab === "templates" ? (
            <TemplatesGallery projectId={projectId} />
          ) : tab === "runs" ? (
            <RunsTable projectId={projectId} />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
              <AutomationsPanel projectId={projectId} />
              <aside>
                <SectionLabel className="mb-2">Next</SectionLabel>
                <NextRuns projectId={projectId} />
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
