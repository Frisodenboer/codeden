import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Markdown } from "@/components/thread/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClient } from "@/lib/api";

/** "What's new": the release notes for `version` (GitHub Release body or CHANGELOG). */
export function WhatsNewDialog({
  version,
  open,
  onOpenChange,
  onUpdate,
}: {
  version: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown as "Update now" when the running copy can update itself. */
  onUpdate?: () => void;
}) {
  const client = useClient();
  const notes = useQuery({
    queryKey: ["update-notes", version],
    queryFn: () => client.updates.notes(version),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="whats-new">
        <DialogHeader>
          <DialogTitle>What's new in CodeBench {version}</DialogTitle>
          <DialogDescription>Release notes from the CodeDen repository.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto text-sm">
          {notes.isPending ? (
            <p className="text-muted-foreground">Loading the release notes...</p>
          ) : notes.data?.body ? (
            <Markdown>{notes.data.body}</Markdown>
          ) : (
            <p className="text-muted-foreground">
              The release notes couldn't be loaded. Read them on the release page.
            </p>
          )}
        </div>
        <DialogFooter>
          {notes.data?.url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={notes.data.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Release page
              </a>
            </Button>
          )}
          {onUpdate && (
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onUpdate();
              }}
            >
              Update now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
