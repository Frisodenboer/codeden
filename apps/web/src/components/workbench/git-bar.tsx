import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, GitBranch, GitCommitHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useClient } from "@/lib/api";

/** Branch, ahead/behind and uncommitted count for the session worktree, with commit and push (§9). */
export function GitBar({ sessionId, title }: { sessionId: string; title: string }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const status = useQuery({
    queryKey: ["git-status", sessionId],
    queryFn: () => client.gitStatus(sessionId),
    retry: false,
    refetchInterval: 15_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["git-status", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["diff", sessionId] });
  };
  const commit = useMutation({
    mutationFn: () => client.gitCommit(sessionId, { message: message.trim() }),
    onSuccess: (r) => {
      setOpen(false);
      setMessage("");
      toast.success(r.commit ? `Committed ${r.commit.slice(0, 7)}` : "Nothing to commit");
      refresh();
    },
    onError: (e) => toast.error("Commit failed", { description: e.message }),
  });
  const push = useMutation({
    mutationFn: () => client.gitPush(sessionId, {}),
    onSuccess: (r) => {
      toast.success(`Pushed ${r.branch} to ${r.remote}`);
      refresh();
    },
    onError: (e) => toast.error("Push failed", { description: e.message }),
  });

  const data = status.data;
  if (!data) return null;
  const changed = data.files.length;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-2xs text-muted-foreground">
      <GitBranch className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate font-mono" title={data.branch ?? undefined}>
        {data.branch ?? "detached"}
      </span>
      {(data.ahead > 0 || data.behind > 0) && (
        <span className="shrink-0 tabular-nums">
          ↑{data.ahead} ↓{data.behind}
        </span>
      )}
      <span className="shrink-0">{changed === 0 ? "clean" : `${changed} uncommitted`}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={changed === 0}
          onClick={() => {
            setMessage((m) => m || title);
            setOpen(true);
          }}
        >
          <GitCommitHorizontal /> Commit
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={push.isPending || !data.branch}
          onClick={() => push.mutate()}
        >
          <ArrowUp /> {push.isPending ? "Pushing…" : "Push"}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              Stages all {changed} changed file{changed === 1 ? "" : "s"} in the session worktree.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-24 font-mono text-[13px]"
            aria-label="Commit message"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!message.trim() || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? "Committing…" : "Commit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
