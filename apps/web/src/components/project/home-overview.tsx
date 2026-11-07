import { Link } from "@tanstack/react-router";
import { FolderPlus, Hammer, MessageSquarePlus } from "lucide-react";
import { SectionLabel } from "@/components/common/bits";
import { SessionsList } from "@/components/project/lists";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSnapshot } from "@/lib/queries";
import { useUiStore } from "@/stores/ui";

/**
 * Home when there is no orchestrator session: your projects with a one-click new session,
 * and the most recent agent sessions across them.
 */
export function HomeOverview() {
  const { data } = useSnapshot();
  const setAddProject = useUiStore((s) => s.setAddProjectOpen);
  if (!data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full max-w-2xl" />
      </div>
    );
  }
  const recent = data.sessions
    .filter((s) => s.role === "agent")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 12);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="relative mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow),transparent)]"
        />
        <div className="relative">
          <div className="mb-3 flex size-11 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <Hammer className="size-5 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">What should we build?</h2>
          <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">
            Pick a project and start an agent session. Each one works in its own worktree and
            branch, with diffs, a terminal and approvals right here.
          </p>
        </div>

        <section className="relative">
          <div className="mb-2 flex items-center">
            <SectionLabel>Projects · {data.projects.length}</SectionLabel>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => setAddProject(true)}
            >
              <FolderPlus /> Add project
            </Button>
          </div>
          {data.projects.length === 0 ? (
            <button
              type="button"
              onClick={() => setAddProject(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border px-4 py-6 text-left text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <FolderPlus className="size-5 text-primary" />
              Add a local folder or clone a GitHub repo to get started.
            </button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.projects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
                >
                  <ProjectTile project={p} className="size-7 text-xs" />
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    className="min-w-0 flex-1"
                  >
                    <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                    <span className="block truncate font-mono text-3xs text-muted-foreground">
                      {p.path}
                    </span>
                  </Link>
                  <Button size="xs" variant="outline" asChild>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      search={{ newSession: true }}
                    >
                      <MessageSquarePlus /> New session
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section className="relative">
            <SectionLabel className="mb-2">Recent sessions</SectionLabel>
            <SessionsList sessions={recent} />
          </section>
        )}
      </div>
    </div>
  );
}
