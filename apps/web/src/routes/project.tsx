import { Link, useNavigate } from "@tanstack/react-router";
import { Bot, FileText, FolderGit2, GitBranch, MessageSquarePlus } from "lucide-react";
import { SectionLabel } from "@/components/common/bits";
import { ProjectGithub } from "@/components/github/project-github";
import { FactoryPanel } from "@/components/project/factory-panel";
import { AutomationsList, SessionsList } from "@/components/project/lists";
import { NewSessionDialog } from "@/components/project/new-session-dialog";
import { NowNext } from "@/components/project/now-next";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { Button } from "@/components/ui/button";
import { ProjectSpendCard } from "@/components/usage/project-spend-card";
import { useProjectStatus } from "@/lib/orchestration";
import { useSnapshot } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";

const modeLabel = {
  manual: "Manual",
  assisted: "Assisted",
  autopilot: "Autopilot",
  dark_factory: "Dark factory",
};

export type ProjectTab = "overview" | "github";

/** Project home: Now / Next, factory panel, sessions and automations, and GitHub (§8.4, §9). */
export function ProjectPage({
  projectId,
  newSession,
  tab,
}: {
  projectId: string;
  newSession: boolean;
  tab: ProjectTab;
}) {
  const { data } = useSnapshot();
  const navigate = useNavigate();
  const { work, status } = useProjectStatus(projectId);
  const project = data?.projects.find((p) => p.id === projectId);
  if (!data || !project) return null;
  const agents = data.sessions.filter((s) => s.projectId === projectId && s.role === "agent");
  const automations = data.automations.filter(
    (a) => a.target.type === "project" && a.target.projectId === projectId,
  );
  const scheduled = (status?.scheduled ?? data.scheduled.filter((r) => r.projectId === projectId))
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const factory = project.autonomyMode === "autopilot" || project.autonomyMode === "dark_factory";
  const titleOf = (id: string | null) => data.sessions.find((s) => s.id === id)?.title ?? null;
  const go = (search: { newSession?: boolean; tab?: ProjectTab }) =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search, replace: true });
  const tabSearch = tab === "overview" ? {} : { tab };

  return (
    <>
      <PageHeader
        icon={<ProjectTile project={project} className="size-5 text-2xs" />}
        title={project.name}
        meta={
          <span className="flex items-center gap-2">
            {project.kind === "github" ? (
              <span className="flex items-center gap-1">
                <GitBranch className="size-3" /> {project.github.owner}/{project.github.repo}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <FolderGit2 className="size-3" /> Local folder
              </span>
            )}
            <span className="rounded-full border border-border px-1.5 py-px">
              {modeLabel[project.autonomyMode]}
            </span>
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/projects/$projectId/vision" params={{ projectId }}>
                <FileText /> Vision
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/projects/$projectId/pm" params={{ projectId }}>
                <Bot /> Talk to the PM
              </Link>
            </Button>
            <Button size="sm" onClick={() => go({ ...tabSearch, newSession: true })}>
              <MessageSquarePlus /> New session
            </Button>
          </>
        }
      />
      <div
        className="flex h-10 shrink-0 items-end gap-4 border-b border-border px-6"
        role="tablist"
      >
        {(["overview", "github"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => go(t === "overview" ? {} : { tab: t })}
            className={cn(
              "-mb-px border-b-2 border-transparent pb-2 text-[13px] text-muted-foreground hover:text-foreground",
              tab === t && "border-primary text-foreground",
            )}
          >
            {t === "overview" ? "Overview" : "GitHub"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-6">
          {tab === "github" ? (
            <ProjectGithub project={project} />
          ) : (
            <>
              <NowNext work={work} scheduled={scheduled} titleOf={titleOf} />
              {factory && <FactoryPanel projectId={projectId} />}
              <ProjectSpendCard projectId={projectId} />
              <section>
                <SectionLabel className="mb-2">Sessions · {agents.length}</SectionLabel>
                <SessionsList
                  sessions={[...agents].sort(
                    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
                  )}
                />
              </section>
              <section id="automations">
                <SectionLabel className="mb-2">
                  Automations · {automations.filter((a) => a.enabled).length} on
                </SectionLabel>
                <AutomationsList automations={automations} scheduled={scheduled} />
              </section>
            </>
          )}
        </div>
      </div>
      <NewSessionDialog
        projectId={projectId}
        open={newSession}
        onOpenChange={(open) => go(open ? { ...tabSearch, newSession: true } : tabSearch)}
      />
    </>
  );
}
