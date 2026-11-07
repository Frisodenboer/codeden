import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, GitBranch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useClient } from "@/lib/api";
import type { CreateProjectInput } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { FolderBrowser } from "./folder-browser";

/** Pick a local folder (server-side picker) or clone a GitHub repo. Shared by setup and the sidebar. */
export function ProjectSourcePicker({
  onCreated,
  submitLabel = "Add project",
}: {
  onCreated: (projectId: string) => void;
  submitLabel?: string;
}) {
  const client = useClient();
  const [source, setSource] = useState<"folder" | "clone">("folder");
  const [folder, setFolder] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const create = useMutation({
    mutationFn: (input: CreateProjectInput) => client.createProject(input),
    onSuccess: (p) => {
      toast.success(`Added ${p.name}`, {
        description: "Detected pnpm · suggested setup script: pnpm install",
      });
      onCreated(p.id);
    },
    onError: (e) => toast.error("Couldn't add the project", { description: e.message }),
  });
  const valid =
    source === "folder"
      ? Boolean(folder)
      : /^(https:\/\/|git@)github\.com[:/].+\/.+/.test(url.trim());

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            [
              "folder",
              FolderOpen,
              "Local folder",
              "Any folder; GitHub features turn on when it has a GitHub remote.",
            ],
            [
              "clone",
              GitBranch,
              "Clone from GitHub",
              "Paste a repository URL and CodeDen clones it.",
            ],
          ] as const
        ).map(([id, Icon, title, desc]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSource(id)}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              source === id
                ? "border-primary/50 bg-primary/[0.06]"
                : "border-border hover:bg-accent/40",
            )}
          >
            <Icon
              className={cn(
                "mb-2 size-4",
                source === id ? "text-primary" : "text-muted-foreground",
              )}
            />
            <div className="text-[13px] font-medium">{title}</div>
            <div className="mt-0.5 text-2xs leading-snug text-muted-foreground">{desc}</div>
          </button>
        ))}
      </div>
      {source === "folder" ? (
        <FolderBrowser value={folder} onChange={setFolder} />
      ) : (
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="font-mono text-[13px]"
          autoFocus
        />
      )}
      <div className="flex justify-end">
        <Button
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              source === "folder"
                ? { source: "folder", path: folder ?? "" }
                : { source: "clone", url: url.trim() },
            )
          }
        >
          {create.isPending ? (source === "clone" ? "Cloning…" : "Adding…") : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function AddProjectDialog() {
  const open = useUiStore((s) => s.addProjectOpen);
  const setOpen = useUiStore((s) => s.setAddProjectOpen);
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            GitHub repos get issues, PRs and evidence. Local folders work too.
          </DialogDescription>
        </DialogHeader>
        <ProjectSourcePicker
          onCreated={(projectId) => {
            setOpen(false);
            void navigate({ to: "/projects/$projectId", params: { projectId } });
          }}
        />
        <DialogFooter className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
