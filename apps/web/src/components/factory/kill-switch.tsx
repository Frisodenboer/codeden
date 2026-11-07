import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Power } from "lucide-react";
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
import { useClient } from "@/lib/api";
import { factoryKeys } from "@/lib/factory";

/**
 * A kill switch (§10.1) with a confirmation: one project's, or every project's (`global`).
 * Turning it on stops the loop and every factory session at once; building items go back to
 * the backlog and open PRs stay open.
 */
export function KillSwitchButton({
  scope,
  on,
  size = "sm",
}: {
  scope: { projectId: string } | "global";
  /** The switch's current state. */
  on: boolean;
  size?: "sm" | "xs";
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const global = scope === "global";
  const kill = useMutation({
    mutationFn: (next: boolean) => client.factory.killSwitch(scope, next),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: factoryKeys.all });
      if (res.on) {
        const n = res.stoppedSessions.length;
        toast.warning(global ? "Every factory stopped" : "Factory stopped", {
          description: `${n} factory session${n === 1 ? "" : "s"} halted.`,
        });
      } else toast.success(global ? "Factories may run again" : "Kill switch off");
    },
    onError: (e) => toast.error("Couldn't change the kill switch", { description: e.message }),
  });
  const label = on
    ? global
      ? "Release global kill switch"
      : "Release kill switch"
    : global
      ? "Stop every factory"
      : "Kill switch";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={on ? "outline" : "destructive"} disabled={kill.isPending}>
          <Power /> {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {on
              ? global
                ? "Let factories run again?"
                : "Release the kill switch?"
              : global
                ? "Stop every project's factory now?"
                : "Stop this factory now?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {on
              ? "The loop picks up backlog items again within your limits. A paused loop stays paused until you resume it."
              : `This stops the loop and every factory session${global ? " in every project" : " in this project"} immediately. Items being built go back to the backlog; open PRs stay open.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => kill.mutate(!on)}
            variant={on ? "default" : "destructive"}
          >
            {on ? "Release" : "Stop everything"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
