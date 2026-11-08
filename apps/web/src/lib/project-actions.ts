import type { Project, Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { useClient } from "./api";
import { moveWithinGroup, restoreOrder, withOrder, withPinned } from "./project-order";
import { snapshotKey } from "./queries";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Pin, unpin and reorder projects (§13). Changes apply to the snapshot at once and are rolled
 * back with a toast if the server rejects them; the server's event then confirms them.
 */
export function useProjectActions() {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMemo(() => {
    const projects = () => queryClient.getQueryData<Snapshot>(snapshotKey)?.projects ?? [];
    const setProjects = (change: (list: Project[]) => Project[]) =>
      queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
        s ? { ...s, projects: change(s.projects) } : s,
      );

    async function optimistic(
      change: (list: Project[]) => Project[],
      save: () => Promise<unknown>,
      failure: string,
    ): Promise<boolean> {
      const before = projects();
      setProjects(change);
      try {
        await save();
        return true;
      } catch (error) {
        setProjects((list) => restoreOrder(list, before));
        toast.error(failure, { description: message(error) });
        return false;
      }
    }

    const reorder = (projectIds: string[]) =>
      optimistic(
        (list) => withOrder(list, projectIds),
        () => client.reorderProjects(projectIds),
        "Couldn't save the project order",
      );

    return {
      setPinned: (project: Project, pinned: boolean) =>
        optimistic(
          (list) => withPinned(list, project.id, pinned),
          () => client.updateProject(project.id, { pinned }),
          pinned ? `Couldn't pin ${project.name}` : `Couldn't unpin ${project.name}`,
        ),
      reorder,
      /** Move a project to position `to` within its group (pinned or not). */
      moveTo: async (projectId: string, to: number) => {
        const ids = moveWithinGroup(projects(), projectId, to);
        return ids ? reorder(ids) : false;
      },
    };
  }, [client, queryClient]);
}
