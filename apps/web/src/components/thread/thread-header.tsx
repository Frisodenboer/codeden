import type { Session } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  Copy,
  FolderTree,
  GitBranch,
  MoreHorizontal,
  PanelRight,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { IssueBadge, PrBadge, ProviderMark } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionCostChip } from "@/components/usage/session-cost";
import { useClient } from "@/lib/api";
import { statusLabel } from "@/lib/format";
import { platform } from "@/lib/platform";
import { useProject, useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout";
import { AutonomyBadge } from "./autonomy";

function Chip({
  icon,
  children,
  title,
  className,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 max-w-44 items-center gap-1.5 rounded-md border border-border/80 px-2 text-2xs text-muted-foreground [&_svg]:size-3",
        className,
      )}
    >
      {icon}
      <span className="truncate font-mono">{children}</span>
    </span>
  );
}

/** Top bar of a thread: title, provider/model, branch, worktree, autonomy and actions. */
export function ThreadHeader({ session, running }: { session: Session; running: boolean }) {
  const client = useClient();
  const project = useProject(session.projectId);
  const layout = useLayoutStore();
  const provider = useSnapshotData(
    (s) => s.runner.providers.find((p) => p.id === session.provider),
    undefined,
  );
  const model = provider?.models.find((m) => m.id === session.model)?.label ?? session.model;
  const stop = useMutation({
    mutationFn: () => client.interrupt(session.id),
    onSuccess: () => toast("Turn stopped"),
  });
  const end = useMutation({
    mutationFn: () => client.stopSession(session.id),
    onSuccess: () => toast("Session stopped"),
  });

  const title =
    session.role === "orchestrator"
      ? "Orchestrator"
      : session.role === "pm"
        ? `${project?.name ?? "Project"} · Project manager`
        : (session.title ?? session.purpose);

  return (
    <header className="@container flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
      {session.role === "agent" ? (
        <StatusDot status={session.status} />
      ) : (
        <Bot className="size-4 text-primary" />
      )}
      <div className="flex min-w-[10rem] shrink items-baseline gap-2 overflow-hidden">
        {project && session.role === "agent" && (
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="hidden shrink-0 text-[13px] text-muted-foreground hover:text-foreground @[48rem]:inline"
          >
            {project.name} <span className="text-muted-foreground/50">/</span>
          </Link>
        )}
        <h1 className="min-w-0 truncate text-[14px] font-medium">{title}</h1>
        <span
          className={cn(
            "shrink-0 text-2xs",
            session.status === "waiting" ? "text-status-waiting" : "text-muted-foreground",
          )}
        >
          {statusLabel[session.status]}
        </span>
      </div>

      <div className="ml-1 hidden min-w-0 shrink-0 items-center gap-1.5 @[36rem]:flex">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border/80 px-2 text-2xs whitespace-nowrap text-muted-foreground">
          <ProviderMark provider={session.provider} className="size-3.5 text-[8px]" />
          {provider?.displayName ?? session.provider}
          {model && <span className="text-foreground/80">· {model}</span>}
        </span>
        {session.branch && (
          <Chip
            className="hidden @[54rem]:inline-flex"
            icon={<GitBranch />}
            title={`Base: ${session.baseBranch ?? "main"}`}
          >
            {session.branch}
          </Chip>
        )}
        {session.worktreePath && (
          <Chip
            className="hidden @[70rem]:inline-flex"
            icon={<FolderTree />}
            title={session.worktreePath}
          >
            {session.worktreePath.split(/[\\/]/).at(-1)}
          </Chip>
        )}
        <SessionCostChip sessionId={session.id} className="hidden @[40rem]:inline-flex" />
        <AutonomyBadge level={session.autonomy} />
        {session.issue && (
          <IssueBadge issue={session.issue} className="hidden h-6 @[44rem]:inline-flex" />
        )}
        {session.pr && <PrBadge pr={session.pr} className="hidden h-6 @[44rem]:inline-flex" />}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {running && (
          <Button
            size="xs"
            variant="outline"
            className="mr-1 gap-1.5"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            <Square className="size-2.5 fill-current" /> Stop
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "text-muted-foreground",
                layout.drawerOpen && "bg-accent text-foreground",
              )}
              onClick={() => layout.toggleDrawer()}
              aria-label="Toggle terminal"
            >
              <SquareTerminal />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Terminal · Ctrl J</TooltipContent>
        </Tooltip>
        {session.worktreePath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-muted-foreground",
                  layout.rightOpen && "bg-accent text-foreground",
                )}
                onClick={() => layout.toggleRight()}
                aria-label="Toggle right panel"
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Right panel · Ctrl \</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="More"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {session.branch && (
              <DropdownMenuItem
                onSelect={() =>
                  void platform
                    .writeClipboard(session.branch ?? "")
                    .then(() => toast.success("Branch copied"))
                }
              >
                <Copy /> Copy branch name
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => layout.openRightTab("details")}>
              <Bot /> Session details
            </DropdownMenuItem>
            {session.role === "agent" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => end.mutate()}>
                  <X /> Stop session
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
