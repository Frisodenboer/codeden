import type { StartWorkResult } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClient } from "@/lib/api";
import type { ConflictCase } from "@/lib/api/types";
import { ConflictCard } from "./conflict-card";

/** Start an agent session; shows the conflict card when matching work is already running. */
export function NewSessionDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useClient();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [workKey, setWorkKey] = useState("");
  const [conflict, setConflict] = useState<ConflictCase | null>(null);
  const start = useMutation({
    mutationFn: () =>
      client.startSession({ projectId, prompt, workKey: workKey.trim() || undefined }),
    onSuccess: (result: StartWorkResult) => {
      if (result.status === "started") {
        onOpenChange(false);
        setPrompt("");
        void navigate({ to: "/sessions/$sessionId", params: { sessionId: result.sessionId } });
      } else {
        setConflict({
          id: `local-${Date.now()}`,
          projectId,
          request: { purpose: prompt, workKey: workKey.trim(), requestedBy: "You" },
          existing: result.existing,
          createdAt: new Date().toISOString(),
        });
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setConflict(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New agent session</DialogTitle>
          <DialogDescription>
            Runs in its own worktree and branch. Duplicate work is detected before anything starts.
          </DialogDescription>
        </DialogHeader>
        {conflict ? (
          <ConflictCard
            conflict={conflict}
            onResolved={() => {
              setConflict(null);
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ns-prompt">What should the agent do?</Label>
              <Textarea
                id="ns-prompt"
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Fix #151: add dark mode using the existing theme tokens…"
                className="min-h-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ns-key">
                Work key <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="ns-key"
                value={workKey}
                onChange={(e) => setWorkKey(e.target.value)}
                placeholder="issue:151 — try automation:security-audit to see a conflict"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!prompt.trim() || start.isPending} onClick={() => start.mutate()}>
                Start session
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
