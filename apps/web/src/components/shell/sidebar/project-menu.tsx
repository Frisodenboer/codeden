import type { Project } from "@codeden/contracts";
import { ArrowDown, ArrowUp, Ellipsis, Pin, PinOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectActions } from "@/lib/project-actions";

/** Where a project sits in its group (pinned or not), for Move up / Move down. */
export interface GroupPosition {
  index: number;
  count: number;
}

/** The ⋯ menu on a project row: pin or unpin, and keyboard-friendly moves within its group. */
export function ProjectMenu({ project, position }: { project: Project; position: GroupPosition }) {
  const actions = useProjectActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        aria-label={`${project.name} actions`}
        title="More actions"
      >
        <Ellipsis className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => void actions.setPinned(project, !project.pinned)}>
          {project.pinned ? <PinOff /> : <Pin />}
          {project.pinned ? "Unpin" : "Pin"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={position.index === 0}
          onSelect={() => void actions.moveTo(project.id, position.index - 1)}
        >
          <ArrowUp /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={position.index >= position.count - 1}
          onSelect={() => void actions.moveTo(project.id, position.index + 1)}
        >
          <ArrowDown /> Move down
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
