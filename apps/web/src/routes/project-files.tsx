import type { ProjectFileOp } from "@codeden/contracts";
import { File as FileView } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FilePlus, Files, FolderPlus, PanelLeft, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/bits";
import {
  ProjectFileTree,
  projectFilesKey,
  useProjectFiles,
} from "@/components/files/project-file-tree";
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
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { parentOf, useFileExplorer } from "@/stores/file-explorer";
import { useLayoutStore } from "@/stores/layout";
import { useResolvedTheme } from "@/stores/theme";
import { PageHeader } from "./page-header";

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/**
 * Project file manager on the main checkout. The folder tree lives in the sidebar under the
 * project's Files row (like VS Code's explorer); this page shows the open file and the dialogs.
 * When the sidebar tree is closed (or the sidebar is collapsed), the page shows the tree itself.
 */
export function ProjectFilesPage({ projectId }: { projectId: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const theme = useResolvedTheme();
  const project = useProject(projectId);
  const list = useProjectFiles(projectId);
  const selected = useFileExplorer((s) => s.selected[projectId] ?? null);
  const treeInSidebar = useFileExplorer((s) => s.treeOpen[projectId] ?? false);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed ?? false);
  const dialog = useFileExplorer((s) => (s.dialog?.projectId === projectId ? s.dialog : null));
  const { select, reveal, setTreeOpen, openDialog, closeDialog } = useFileExplorer.getState();
  const [name, setName] = useState("");
  const showPageTree = !treeInSidebar || sidebarCollapsed;

  // Opening Files shows the tree in the sidebar, like VS Code's explorer.
  useEffect(() => {
    useFileExplorer.getState().setTreeOpen(projectId, true);
  }, [projectId]);

  // Fill the name field when a dialog opens.
  useEffect(() => {
    if (dialog?.mode === "rename") setName(dialog.path);
    else if (dialog?.mode === "createFile" || dialog?.mode === "createDir") setName("");
  }, [dialog]);

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
      void queryClient.invalidateQueries({ queryKey: projectFilesKey(projectId) });
      const done = {
        createFile: "File created",
        createDir: "Folder created",
        rename: "Renamed",
        delete: "Deleted",
      }[o.op];
      toast.success(`${done}: ${res.path}`);
      if (o.op === "delete") {
        if (selected && (selected.path === o.path || selected.path.startsWith(`${o.path}/`)))
          select(projectId, null);
      } else {
        reveal(projectId, res.path);
        const kind =
          o.op === "createDir" ? "dir" : o.op === "rename" ? (selected?.kind ?? "file") : "file";
        select(projectId, { path: res.path, kind });
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

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    const value = name
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (!value || !dialog || dialog.mode === "delete") return;
    if (dialog.mode === "rename") {
      if (value !== dialog.path) op.mutate({ op: "rename", from: dialog.path, to: value });
    } else {
      op.mutate({ op: dialog.mode, path: join(dialog.folder, value) });
    }
    closeDialog();
  };

  const nameDialog = dialog && dialog.mode !== "delete" ? dialog : null;
  const toDelete = dialog?.mode === "delete" ? dialog : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<Files />}
        title={openFile ?? `${project?.name ?? "Project"} files`}
        meta={<code className="font-mono">{list.data?.root ?? project?.path}</code>}
        actions={
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/projects/$projectId" params={{ projectId }}>
                <ChevronLeft /> Project
              </Link>
            </Button>
            {!sidebarCollapsed && (
              <Button
                size="sm"
                variant="ghost"
                title={
                  treeInSidebar ? "Show the tree on this page" : "Show the tree in the sidebar"
                }
                onClick={() => setTreeOpen(projectId, !treeInSidebar)}
              >
                <PanelLeft />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              title="Refresh"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: projectFilesKey(projectId) })
              }
            >
              <RefreshCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog({ projectId, mode: "createDir", folder: targetFolder })}
            >
              <FolderPlus /> New folder
            </Button>
            <Button
              size="sm"
              onClick={() => openDialog({ projectId, mode: "createFile", folder: targetFolder })}
            >
              <FilePlus /> New file
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ProjectFileTree
          projectId={projectId}
          className={cn(
            "max-h-[45%] shrink-0 overflow-y-auto border-b border-border p-1.5 scroll-thin md:max-h-none md:w-80 md:border-r md:border-b-0",
            // On wide screens the tree is in the sidebar; phones always show it here.
            !showPageTree && "md:hidden",
          )}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto scroll-thin">
          {!openFile ? (
            <EmptyState icon={<Files />} title="Pick a file" className="h-full">
              {showPageTree
                ? "Browse the project folder. .git and node_modules are hidden."
                : "Pick a file in the tree on the left, under Files."}
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

      <Dialog open={nameDialog !== null} onOpenChange={(o) => !o && closeDialog()}>
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
              <Button type="button" variant="ghost" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {nameDialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && closeDialog()}>
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
                closeDialog();
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
