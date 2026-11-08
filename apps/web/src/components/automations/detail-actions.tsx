import type { AutomationListItem } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Copy, FileCode2, Import, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClient } from "@/lib/api";
import { automationKeys } from "@/lib/automations";

/** "From file", "Created by the PM" and "Imported" badges of an automation. */
export function OriginBadges({ item }: { item: AutomationListItem }) {
  const by = item.automation.createdBy;
  return (
    <>
      {item.readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex items-center gap-1 rounded bg-muted px-1.5 py-px text-3xs text-muted-foreground"
              data-testid="from-file-badge"
            >
              <FileCode2 className="size-3" /> From file
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono">
            {item.path ?? "Built in"} · edit the file, or duplicate it to edit here
          </TooltipContent>
        </Tooltip>
      )}
      {by === "pm" && (
        <span className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-px text-3xs text-primary">
          <Bot className="size-3" /> Created by the PM
        </span>
      )}
      {by === "import" && (
        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-px text-3xs text-muted-foreground">
          <Import className="size-3" /> Imported
        </span>
      )}
    </>
  );
}

/** Duplicate (or, for file automations, "Duplicate to edit") and delete. */
export function DetailActions({
  item,
  projectId,
}: {
  item: AutomationListItem;
  projectId: string;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const a = item.automation;
  const open = (automationId: string) =>
    void navigate({
      to: "/projects/$projectId/automations/$automationId",
      params: { projectId, automationId },
    });
  const duplicate = useMutation({
    mutationFn: () =>
      client.automations.duplicate(a.id, a.target.type === "project" ? { projectId } : {}),
    onSuccess: (copy) => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
      toast.success(`${copy.automation.name} created, off`);
      open(copy.automation.id);
    },
    onError: (e) => toast.error("Couldn't duplicate", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: () => client.automations.remove(a.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
      toast.success(`${a.name} deleted`);
      void navigate({ to: "/projects/$projectId/automations", params: { projectId } });
    },
    onError: (e) => toast.error("Couldn't delete", { description: e.message }),
  });
  return (
    <>
      <Button
        size="sm"
        variant={item.readOnly ? "default" : "ghost"}
        onClick={() => duplicate.mutate()}
        disabled={duplicate.isPending}
      >
        <Copy /> {item.readOnly ? "Duplicate to edit" : "Duplicate"}
      </Button>
      {!item.readOnly && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${a.name}`}>
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {a.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                It stops running and disappears from every project. Its past runs and their sessions
                stay. Export it first if you may want it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
