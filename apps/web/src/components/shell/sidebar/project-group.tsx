import type { Project, Session } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { Bot, ChevronRight, House, Plus } from "lucide-react";
import { useState } from "react";
import { IssueBadge, PrBadge } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { ageShort, statusTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout";
import { NavRow, rowBase, useIsActive } from "./nav-row";
import { ProjectAutomations } from "./project-automations";

const order: Record<string, number> = { waiting: 0, running: 1, starting: 1, failed: 2, queued: 3 };
const LIMIT = 5;

function sortSessions(list: Session[]): Session[] {
  return [...list].sort(
    (a, b) =>
      (order[a.status] ?? 4) - (order[b.status] ?? 4) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

/** Project tile: initial on a tinted square. */
export function ProjectTile({ project, className }: { project: Project; className?: string }) {
  const hue = (project.slug.split("").reduce((h, c) => h + c.charCodeAt(0), 0) * 29) % 360;
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] text-3xs font-bold uppercase",
        className,
      )}
      style={{ background: `oklch(0.7 0.11 ${hue} / 0.2)`, color: `oklch(0.75 0.13 ${hue})` }}
      aria-hidden
    >
      {project.name.charAt(0)}
    </span>
  );
}

function SessionRow({ session }: { session: Session }) {
  const tone = statusTone[session.status];
  const settled = tone === "done" || tone === "idle";
  return (
    <NavRow
      href={`/sessions/${session.id}`}
      link={{ to: "/sessions/$sessionId", params: { sessionId: session.id } }}
      className="pl-7"
      title={session.progress?.text ?? session.purpose}
    >
      <StatusDot status={session.status} />
      <span className={cn("min-w-0 flex-1 truncate", settled && "text-sidebar-foreground/55")}>
        {session.title ?? session.purpose}
      </span>
      {session.pr ? (
        <PrBadge pr={session.pr} />
      ) : session.issue ? (
        <IssueBadge issue={session.issue} />
      ) : null}
      <span
        className={cn(
          "w-6 shrink-0 text-right text-3xs tabular-nums",
          tone === "waiting" ? "font-medium text-status-waiting" : "text-muted-foreground/70",
        )}
      >
        {tone === "waiting" ? "you" : ageShort(session.updatedAt)}
      </span>
    </NavRow>
  );
}

/** One project in the sidebar: header, PM, sessions and automations. */
export function ProjectGroup({ project, sessions }: { project: Project; sessions: Session[] }) {
  const open = useLayoutStore((s) => s.expandedProjects[project.id] ?? false);
  const toggle = useLayoutStore((s) => s.toggleProject);
  const [showAll, setShowAll] = useState(false);
  const homeActive = useIsActive(`/projects/${project.id}`, false);
  const pm = sessions
    .filter((s) => s.role === "pm")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const agents = sortSessions(sessions.filter((s) => s.role === "agent" && !s.archivedAt));
  const visible = showAll ? agents : agents.slice(0, LIMIT);
  const attention = agents.some((s) => s.status === "waiting");
  const running = agents.filter((s) => statusTone[s.status] === "running").length;

  return (
    <div className="flex flex-col gap-px">
      <div
        className={cn(rowBase, "group/head pr-1", homeActive && "text-sidebar-accent-foreground")}
      >
        <button
          type="button"
          onClick={() => toggle(project.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
          aria-expanded={open}
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90",
            )}
          />
          <ProjectTile project={project} />
          <span className="truncate font-medium">{project.name}</span>
          {!open && (attention || running > 0) && (
            <span className="ml-auto flex items-center gap-1 pr-1">
              {attention && <span className="size-1.5 rounded-full bg-status-waiting" />}
              {running > 0 && (
                <span className="text-3xs text-muted-foreground tabular-nums">{running}</span>
              )}
            </span>
          )}
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-border hover:text-foreground"
            title="Project home"
          >
            <House className="size-3.5" />
          </Link>
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            search={{ newSession: true }}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-border hover:text-foreground"
            title="New session"
          >
            <Plus className="size-3.5" />
          </Link>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-px">
          <NavRow
            href={`/projects/${project.id}/pm`}
            link={{ to: "/projects/$projectId/pm", params: { projectId: project.id } }}
            className="pl-7"
          >
            <Bot className="size-3.5 shrink-0 text-primary/80" />
            <span className="flex-1 truncate">Project manager</span>
            <span className="rounded-full bg-primary/10 px-1.5 text-3xs font-medium text-primary">
              PM
            </span>
            {pm && <StatusDot status={pm.status} />}
          </NavRow>
          {visible.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
          {agents.length > LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={cn(rowBase, "h-7 pl-7 text-xs text-muted-foreground")}
            >
              {showAll ? "Show less" : `Show ${agents.length - LIMIT} more`}
            </button>
          )}
          <ProjectAutomations projectId={project.id} />
        </div>
      )}
    </div>
  );
}
