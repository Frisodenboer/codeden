import { Link, useNavigate } from "@tanstack/react-router";
import { Bot, FileText, FolderGit2, GitBranch, MessageSquarePlus } from "lucide-react";
import { SectionLabel } from "@/components/common/bits";
import { FactoryPanel } from "@/components/project/factory-panel";
import { AutomationsList, SessionsList } from "@/components/project/lists";
import { NewSessionDialog } from "@/components/project/new-session-dialog";
import { NowNext } from "@/components/project/now-next";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { Button } from "@/components/ui/button";
import { isActive } from "@/lib/format";
import { useSnapshot } from "@/lib/queries";
import { PageHeader } from "./page-header";

const modeLabel = {
  manual: "Manual",
  assisted: "Assisted",
  autopilot: "Autopilot",
  dark_factory: "Dark factory",
};

/** Project home: Now / Next, factory panel, sessions and automations (§8.4, §10.1). */
export function ProjectPage({ projectId, newSession }: { projectId: string; newSession: boolean }) {
  const { data } = useSnapshot();
  const navigate = useNavigate();
  const project = data?.projects.find((p) => p.id === projectId);
  if (!data || !project) return null;
  const sessions = data.sessions.filter((s) => s.projectId === projectId);
  const agents = sessions.filter((s) => s.role === "agent");
  const pm = sessions.find((s) => s.role === "pm");
  const automations = data.automations.filter(
    (a) => a.target.type === "project" && a.target.projectId === projectId,
  );
  const scheduled = data.scheduled
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const factory = project.autonomyMode === "autopilot" || project.autonomyMode === "dark_factory";
  const setDialog = (open: boolean) =>
    void navigate({
      to: "/projects/$projectId",
      params: { projectId },
      search: open ? { newSession: true } : {},
      replace: true,
    });

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
            {pm && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/sessions/$sessionId" params={{ sessionId: pm.id }}>
                  <Bot /> Talk to the PM
                </Link>
              </Button>
            )}
            <Button size="sm" onClick={() => setDialog(true)}>
              <MessageSquarePlus /> New session
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-6">
          <NowNext running={agents.filter((s) => isActive(s.status))} scheduled={scheduled} />
          {factory && <FactoryPanel projectId={projectId} />}
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
        </div>
      </div>
      <NewSessionDialog projectId={projectId} open={newSession} onOpenChange={setDialog} />
    </>
  );
}
