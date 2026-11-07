import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import { updatesKey, useUpdates } from "@/lib/updates";

/** About: the running version against the latest on npm, with a "Check now" button. */
export function UpdateCheck() {
  const client = useClient();
  const queryClient = useQueryClient();
  const { data } = useUpdates();
  const refresh = useMutation({
    mutationFn: () => client.getUpdates({ refresh: true }),
    onSuccess: (status) => queryClient.setQueryData(updatesKey, status),
  });
  if (!data) return null;
  let text: string;
  if (!data.enabled) text = "Update checks are off (Settings > General).";
  else if (data.updateAvailable) text = `Version ${data.latest} is available.`;
  else if (data.error) text = `Couldn't check for updates: ${data.error}`;
  else if (data.latest) text = "You're on the latest version.";
  else text = "Not checked yet.";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs" data-testid="update-check">
      <span className={data.updateAvailable ? "text-status-waiting" : "text-muted-foreground"}>
        {text}
      </span>
      {data.updateAvailable && (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{data.command}</code>
      )}
      {data.enabled && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} /> Check now
        </Button>
      )}
    </div>
  );
}
