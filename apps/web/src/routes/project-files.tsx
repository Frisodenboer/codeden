import type { ProjectFileOp } from "@codeden/contracts";
import { File as FileView } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  File,
  FilePlus,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/bits";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import type { FileNode } from "@/lib/api/types";
import { buildFileTree } from "@/lib/file-tree";
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/stores/theme";
import { PageHeader } from "./page-header";

type Selection = { path: string; kind: "file" | "dir" } | null;
type NameDialog =
  | { mode: "createFile" | "createDir"; folder: string }
  | { mode: "rename"; path: string; kind: "file" | "dir" };

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

function TreeRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
  onRename,
  onDelete,
}: {
  node: FileNode;
  depth: number;
  selected: Selection;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (s: NonNullable<Selection>) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
}) {
  const isDir = node.kind === "dir";
  const open = expanded.has(node.path);
  return (
    <>
      <div
        className={cn(
          "group flex h-[28px] items-center rounded-md pr-1 hover:bg-accent/60",
          selected?.path === node.path && "bg-accent",
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (isDir) onToggle(node.path);
            onSelect({ path: node.path, kind: node.kind });
          }}
          style={{ paddingLeft: 8 + depth * 14 }}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[12.5px] text-foreground/85"
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
            onClick={() => onRename(node)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            title="Delete"
            aria-label={`Delete ${node.name}`}
            onClick={() => onDelete(node)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-status-failed"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      </div>
      {isDir &&
        open &&
        node.children?.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

/** Project file manager: browse, view, create, rename/move and delete files in the main checkout. */
export function ProjectFilesPage({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const theme = useResolvedTheme();
  const project = useProject(projectId);
  const [selected, setSelected] = useState<Selection>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [name, setName] = useState("");
  const [toDelete, setToDelete] = useState<FileNode | null>(null);

  const listKey = ["project-files", projectId];
  const list = useQuery({ queryKey: listKey, queryFn: () => client.listProjectFiles(projectId) });
  const tree = useMemo(() => (list.data ? buildFileTree(list.data.entries) : []), [list.data]);
  const openFile = selected?.kind === "file" ? selected.path : null;
  const file = useQuery({
    queryKey: ["project-file", projectId, openFile],
    queryFn: () => client.readProjectFile(projectId, openFile ?? ""),
    enabled: Boolean(openFile),
    retry: false,
  });

  const op = useMutation({
    mutationFn: (o: ProjectFileOp) => client.projectFileOp(projectId, o),
    onSuccess: (res, o) => {
      queryClient.invalidateQueries({ queryKey: listKey });
      const done = {
        createFile: "File created",
        createDir: "Folder created",
        rename: "Renamed",
        delete: "Deleted",
      }[o.op];
      toast.success(`${done}: ${res.path}`);
      if (o.op === "delete") {
        if (selected && (selected.path === o.path || selected.path.startsWith(`${o.path}/`)))
          setSelected(null);
      } else {
        // Show the result: open its parent folders and select it.
        setExpanded((prev) => {
          const next = new Set(prev);
          let p = parentOf(res.path);
          while (p) {
            next.add(p);
            p = parentOf(p);
          }
          return next;
        });
        const kind =
          o.op === "createDir" ? "dir" : o.op === "rename" ? (selected?.kind ?? "file") : "file";
        setSelected({ path: res.path, kind });
      }
    },
    onError: (error) => toast.error(error.message),
  });

  /** Where "New file" and "New folder" put things: the selected folder, or the selected file's folder. */
  const targetFolder = !selected
    ? ""
    : selected.kind === "dir"
      ? selected.path
      : parentOf(selected.path);

  const startCreate = (mode: "createFile" | "createDir") => {
    setName("");
    setNameDialog({ mode, folder: targetFolder });
  };
  const startRename = (node: FileNode) => {
    setName(node.path);
    setNameDialog({ mode: "rename", path: node.path, kind: node.kind });
  };
  const submitName = (e: FormEvent) => {
    e.preventDefault();
    const value = name
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (!value || !nameDialog) return;
    if (nameDialog.mode === "rename") {
      if (value !== nameDialog.path) op.mutate({ op: "rename", from: nameDialog.path, to: value });
    } else {
      op.mutate({ op: nameDialog.mode, path: join(nameDialog.folder, value) });
    }
    setNameDialog(null);
  };

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<Files />}
        title={`${project?.name ?? "Project"} files`}
        meta={<code className="font-mono">{list.data?.root ?? project?.path}</code>}
        actions={
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/projects/$projectId" params={{ projectId }}>
                <ChevronLeft /> Project
              </Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Refresh"
              onClick={() => queryClient.invalidateQueries({ queryKey: listKey })}
            >
              <RefreshCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
            <Button size="sm" variant="outline" onClick={() => startCreate("createDir")}>
              <FolderPlus /> New folder
            </Button>
            <Button size="sm" onClick={() => startCreate("createFile")}>
              <FilePlus /> New file
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border p-1.5 scroll-thin md:max-h-none md:w-80 md:border-r md:border-b-0">
          {list.error ? (
            <div className="p-2 text-xs text-status-failed">{list.error.message}</div>
          ) : list.isLoading ? (
            <div className="space-y-1.5 p-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-4 w-3/4" />
              ))}
            </div>
          ) : tree.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">This folder is empty.</div>
          ) : (
            <>
              {tree.map((n) => (
                <TreeRow
                  key={n.path}
                  node={n}
                  depth={0}
                  selected={selected}
                  expanded={expanded}
                  onToggle={toggle}
                  onSelect={setSelected}
                  onRename={startRename}
                  onDelete={setToDelete}
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
        <div className="min-h-0 min-w-0 flex-1 overflow-auto scroll-thin">
          {!openFile ? (
            <EmptyState icon={<Files />} title="Pick a file" className="h-full">
              Browse the project folder. .git and node_modules are hidden.
            </EmptyState>
          ) : file.error ? (
            <EmptyState icon={<Files />} title="Can't show this file" className="h-full">
              {file.error.message}
            </EmptyState>
          ) : file.data?.binary ? (
            <EmptyState icon={<Files />} title="Binary file" className="h-full">
              {file.data.path} isn't shown as text.
            </EmptyState>
          ) : file.data ? (
            <FileView
              file={{ name: file.data.path, contents: file.data.content }}
              options={{
                theme: { dark: "pierre-dark", light: "pierre-light" },
                themeType: theme,
                overflow: "scroll",
                stickyHeader: true,
              }}
            />
          ) : (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-3.5" style={{ width: `${50 + ((i * 17) % 45)}%` }} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={nameDialog !== null} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent>
          <form onSubmit={submitName} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {nameDialog?.mode === "createFile"
                  ? "New file"
                  : nameDialog?.mode === "createDir"
                    ? "New folder"
                    : "Rename or move"}
              </DialogTitle>
              <DialogDescription>
                {nameDialog?.mode === "rename"
                  ? "Change the name, or the path to move it to another folder."
                  : `In ${(nameDialog && "folder" in nameDialog && nameDialog.folder) || "the project folder"}. Use / to create subfolders.`}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={nameDialog?.mode === "createDir" ? "folder-name" : "file-name.ts"}
              aria-label="Name"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNameDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {nameDialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.kind === "dir"
                ? `This deletes the folder ${toDelete.path} and everything in it.`
                : `This deletes ${toDelete?.path}.`}{" "}
              It doesn't go to the Recycle Bin. If the project uses git, committed files can be
              restored from git.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) op.mutate({ op: "delete", path: toDelete.path });
                setToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
