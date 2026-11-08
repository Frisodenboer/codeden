import { Link } from "@tanstack/react-router";
import { Bot, Inbox, PanelLeftOpen, Search } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSnapshot } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SIDEBAR, useLayoutStore } from "@/stores/layout";
import { useUiStore } from "@/stores/ui";
import { Logo } from "../logo";
import { useIsActive } from "./nav-row";
import { ProjectTile } from "./project-group";
import { SidebarFooter } from "./sidebar-footer";

function RailItem({
  label,
  active,
  children,
}: {
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground [&>a]:flex [&>a]:size-full [&>a]:items-center [&>a]:justify-center [&>button]:flex [&>button]:size-full [&>button]:items-center [&>button]:justify-center",
            active && "bg-sidebar-accent text-foreground",
          )}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Collapsed sidebar: a 56px icon rail with the same destinations. */
export function SidebarRail() {
  const { data } = useSnapshot();
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const openPalette = useUiStore((s) => s.setPaletteOpen);
  const orchestratorActive = useIsActive("/");
  const inboxActive = useIsActive("/inbox");
  const inboxCount = data?.inbox.filter((i) => i.status === "open").length ?? 0;

  return (
    <aside
      style={{ width: SIDEBAR.rail }}
      className="flex h-full shrink-0 flex-col items-center bg-sidebar"
    >
      <div className="flex h-12 items-center">
        <Logo className="size-[22px]" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <RailItem label="Expand sidebar · Ctrl B">
          <button type="button" onClick={toggleSidebar} aria-label="Expand sidebar">
            <PanelLeftOpen className="size-4" />
          </button>
        </RailItem>
        <RailItem label="Search · Ctrl K">
          <button type="button" onClick={() => openPalette(true)} aria-label="Search">
            <Search className="size-4" />
          </button>
        </RailItem>
        <RailItem label="Orchestrator" active={orchestratorActive}>
          <Link to="/" aria-label="Orchestrator">
            <Bot className="size-4 text-primary" />
          </Link>
        </RailItem>
        <RailItem label={`Inbox · ${inboxCount}`} active={inboxActive}>
          <Link to="/inbox" aria-label="Inbox">
            <Inbox className="size-4" />
            {inboxCount > 0 && (
              <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-waiting px-1 text-[9px] font-bold text-black/80">
                {inboxCount}
              </span>
            )}
          </Link>
        </RailItem>
      </div>
      <div className="my-3 h-px w-6 bg-sidebar-border" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scroll-thin">
        {data?.projects.map((p, i) => {
          const waiting = data.sessions.some((s) => s.projectId === p.id && s.status === "waiting");
          // Same order as the sidebar; a thin rule ends the pinned group.
          const endsPinned = p.pinned && data.projects[i + 1]?.pinned === false;
          return (
            <Fragment key={p.id}>
              <RailItem label={p.pinned ? `${p.name} · pinned` : p.name}>
                <Link to="/projects/$projectId" params={{ projectId: p.id }} aria-label={p.name}>
                  <ProjectTile project={p} className="size-6 rounded-md text-xs" />
                  {waiting && (
                    <span className="absolute top-1 right-1 size-2 rounded-full bg-status-waiting ring-2 ring-sidebar" />
                  )}
                </Link>
              </RailItem>
              {endsPinned && <div className="my-1 h-px w-4 shrink-0 bg-sidebar-border" />}
            </Fragment>
          );
        })}
      </div>
      <SidebarFooter compact />
    </aside>
  );
}
