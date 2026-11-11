import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, File, Folder, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import type { FileNode } from "@/lib/api/types";
import { buildFileTree } from "@/lib/file-tree";
import { cn } from "@/lib/utils";
import { useFileExplorer } from "@/stores/file-explorer";

export const projectFilesKey = (projectId: string) => ["project-files", projectId];

/** The project's file list (main checkout), shared by the sidebar tree and the Files page. */
export function useProjectFiles(projectId: string) {
  const client = useClient();
  return useQuery({
    queryKey: projectFilesKey(projectId),
    queryFn: () => client.listProjectFiles(projectId),
  });
}

function Row({
  projectId,
  node,
  depth,
  dense,
  onOpen,
}: {
  projectId: string;
  node: FileNode;
  depth: number;
  dense: boolean;
  onOpen: () => void;
}) {
  const selected = useFileExplorer((s) => s.selected[projectId]?.path === node.path);
  const open = useFileExplorer((s) => (s.expanded[projectId] ?? []).includes(node.path));
  const { select, toggleDir, openDialog } = useFileExplorer.getState();
  const isDir = node.kind === "dir";
  return (
    <>
      <div
        className={cn(
          "group flex items-center rounded-md pr-1 hover:bg-accent/60",
          dense ? "h-[24px]" : "h-[28px]",
          selected && "bg-accent",
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (isDir) toggleDir(projectId, node.path);
            select(projectId, { path: node.path, kind: node.kind });
            if (!isDir) onOpen();
          }}
          style={{ paddingLeft: (dense ? 4 : 8) + depth * 12 }}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-foreground/85",
            dense ? "text-xs" : "text-[12.5px]",
          )}
        >
          {isDir ? (
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isDir ? (
            open ? (
              <FolderOpen className="size-3.5 shrink-0 text-primary/70" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-primary/70" />
            )
          ) : (
            <File className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        <span className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <button
            type="button"
            title="Rename or move"
            aria-label={`Rename ${node.name}`}
            onClick={() => {
              openDialog({ projectId, mode: "rename", path: node.path, kind: node.kind });
              onOpen();
            }}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            title="Delete"
            aria-label={`Delete ${node.name}`}
            onClick={() => {
              openDialog({
                projectId,
                mode: "delete",
                path: node.path,
                name: node.name,
                kind: node.kind,
              });
              onOpen();
            }}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-status-failed"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      </div>
      {isDir &&
        open &&
        node.children?.map((c) => (
          <Row
            key={c.path}
            projectId={projectId}
            node={c}
            depth={depth + 1}
            dense={dense}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}

/**
 * The project's folder tree, as in VS Code's explorer: used in the sidebar (dense, under the
 * project's Files row) and on the Files page. Opening a file, renaming or deleting goes to the
 * Files page, which shows the file and the dialogs.
 */
export function ProjectFileTree({
  projectId,
  dense = false,
  className,
}: {
  projectId: string;
  dense?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const list = useProjectFiles(projectId);
  const tree = useMemo(() => (list.data ? buildFileTree(list.data.entries) : []), [list.data]);
  const onOpen = () => {
    void navigate({ to: "/projects/$projectId/files", params: { projectId } });
  };

  return (
    <div className={className}>
      {list.error ? (
        <div className="p-2 text-xs text-status-failed">{list.error.message}</div>
      ) : list.isLoading ? (
        <div className="space-y-1.5 p-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-3.5 w-3/4" />
          ))}
        </div>
      ) : tree.length === 0 ? (
        <div className="p-2 text-xs text-muted-foreground">This folder is empty.</div>
      ) : (
        <>
          {tree.map((n) => (
            <Row
              key={n.path}
              projectId={projectId}
              node={n}
              depth={0}
              dense={dense}
              onOpen={onOpen}
            />
          ))}
          {list.data?.truncated && (
            <div className="p-2 text-2xs text-muted-foreground">
              Showing the first 5000 entries.
            </div>
          )}
        </>
      )}
    </div>
  );
}
