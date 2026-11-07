import type { Session } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  ChevronRight,
  FolderGit2,
  Inbox,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { snapshotQuery } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connection";
import { resolveTheme, useThemeStore } from "@/stores/theme";
import { Logo } from "./logo";
import { StatusDot } from "./status-dot";

const navItem =
  "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const navActive = "bg-sidebar-accent text-sidebar-accent-foreground";

/** Left sidebar (§13): orchestrator, inbox, projects with their sessions, runner status. */
export function Sidebar() {
  const { data } = useQuery(snapshotQuery);
  const inboxCount = data?.inbox.filter((i) => i.status === "open").length ?? 0;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-12 items-center gap-2 px-4">
        <Logo className="size-6" />
        <span className="font-heading text-[15px] font-semibold tracking-tight">CodeDen</span>
        <Badge
          variant="outline"
          className="ml-auto h-5 px-1.5 font-mono text-[10px] text-muted-foreground"
        >
          M0
        </Badge>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/40 px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span>Search or run a command</span>
          <Kbd className="ml-auto">Ctrl K</Kbd>
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 py-1">
        <Link
          to="/"
          className={navItem}
          activeProps={{ className: navActive }}
          activeOptions={{ exact: true }}
        >
          <Bot className="size-4 text-primary" />
          <span>Orchestrator</span>
        </Link>
        <Link to="/inbox" className={navItem} activeProps={{ className: navActive }}>
          <Inbox className="size-4" />
          <span>Inbox</span>
          {inboxCount > 0 && (
            <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px]">
              {inboxCount}
            </Badge>
          )}
        </Link>
      </nav>

      <div className="mt-3 flex items-center px-5 pb-1">
        <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          Projects
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground"
              aria-label="Add project"
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add a project</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        {data && data.projects.length > 0 ? (
          <div className="flex flex-col gap-0.5 pb-3">
            {data.projects.map((project) => (
              <ProjectGroup
                key={project.id}
                name={project.name}
                sessions={data.sessions.filter((s) => s.projectId === project.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyProjects />
        )}
      </ScrollArea>

      <SidebarFooter />
    </aside>
  );
}

function ProjectGroup({ name, sessions }: { name: string; sessions: Session[] }) {
  return (
    <div>
      <div className={navItem}>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <FolderGit2 className="size-4" />
        <span className="truncate">{name}</span>
      </div>
      {sessions.map((s) => (
        <div key={s.id} className={cn(navItem, "pl-9")}>
          <StatusDot status={s.status} />
          <span className="truncate">{s.title ?? s.purpose}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyProjects() {
  return (
    <div className="mx-1 mt-1 rounded-lg border border-dashed border-sidebar-border p-4 text-center">
      <FolderGit2 className="mx-auto mb-2 size-5 text-muted-foreground" />
      <p className="text-[13px] font-medium">No projects yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Add a GitHub repo or a local folder to start agent sessions.
      </p>
      <Button size="sm" variant="outline" className="mt-3">
        <Plus /> Add project
      </Button>
    </div>
  );
}

function SidebarFooter() {
  const runner = useConnectionStore((s) => s.runner);
  const socket = useConnectionStore((s) => s.socket);
  const preference = useThemeStore((s) => s.preference);
  const toggle = useThemeStore((s) => s.toggle);
  const dark = resolveTheme(preference) === "dark";

  const label =
    socket !== "open"
      ? "Server offline"
      : runner?.state === "connected"
        ? `Runner ready · ${runner.providers.length} provider${runner.providers.length === 1 ? "" : "s"}`
        : `Runner ${runner?.state ?? "unknown"}`;
  const tone = socket !== "open" ? "failed" : runner?.state === "connected" ? "done" : "waiting";

  return (
    <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-xs text-muted-foreground">
        <Zap className="size-3.5 shrink-0" />
        <StatusDot tone={tone} />
        <span className="truncate" title={runner?.providers.map((p) => p.displayName).join(", ")}>
          {label}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
            {dark ? <Sun /> : <Moon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{dark ? "Light theme" : "Dark theme"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Settings" asChild>
            <Link to="/settings">
              <Settings />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
