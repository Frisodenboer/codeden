import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, LogIn, TriangleAlert, X } from "lucide-react";
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
import { TerminalView } from "@/components/workbench/terminal-view";
import { useClient } from "@/lib/api";
import type { SetupCheck } from "@/lib/api/types";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";

function StateIcon({ state }: { state: SetupCheck["state"] }) {
  const base =
    "flex size-6 shrink-0 items-center justify-center rounded-full transition-all duration-300";
  if (state === "checking")
    return (
      <span className={cn(base, "border border-border")}>
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      </span>
    );
  if (state === "ok")
    return (
      <span className={cn(base, "bg-status-done/15 text-status-done")}>
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (state === "warning")
    return (
      <span className={cn(base, "bg-status-waiting/15 text-status-waiting")}>
        <TriangleAlert className="size-3.5" />
      </span>
    );
  return (
    <span className={cn(base, "bg-status-failed/12 text-status-failed")}>
      <X className="size-3.5" strokeWidth={3} />
    </span>
  );
}

/** First-run checklist (§14): parallel checks with live ticks; one fix per failed check. */
export function SetupChecklist() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [fixing, setFixing] = useState<SetupCheck | null>(null);
  const { data } = useQuery({
    queryKey: ["setup"],
    queryFn: () => client.getSetupStatus(),
    refetchInterval: (q) =>
      q.state.data?.checks.some((c) => c.state === "checking") ? 350 : false,
  });

  const closeFix = async () => {
    const check = fixing;
    setFixing(null);
    if (!check) return;
    const next = await client.recheckSetup(check.id);
    queryClient.setQueryData(["setup"], next);
    const after = next.checks.find((c) => c.id === check.id);
    if (after?.state === "ok") toast.success(`${check.label} is ready`);
  };

  return (
    <>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {(data?.checks ?? []).map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <StateIcon state={c.state} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                {c.label}
                {c.required ? (
                  <span className="text-3xs font-normal text-muted-foreground">required</span>
                ) : null}
              </div>
              <div
                className={cn(
                  "truncate text-2xs",
                  c.state === "missing" ? "text-status-failed/90" : "text-muted-foreground",
                )}
              >
                {c.state === "checking" ? "Checking…" : c.detail}
              </div>
            </div>
            {c.fix && c.state !== "ok" && c.state !== "checking" && (
              <div className="flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  className="font-mono text-muted-foreground"
                  onClick={() =>
                    void platform
                      .writeClipboard(c.fix?.command ?? "")
                      .then(() => toast("Command copied"))
                  }
                >
                  <Copy /> {c.fix.command}
                </Button>
                <Button size="sm" onClick={() => setFixing(c)}>
                  <LogIn /> {c.fix.label}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">
        CodeDen reuses your existing logins and never stores provider or GitHub credentials. At
        least one agent provider is required; GitHub is recommended.
      </p>
      <Dialog open={fixing !== null} onOpenChange={(o) => !o && void closeFix()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {fixing?.fix?.label} · {fixing?.label}
            </DialogTitle>
            <DialogDescription>
              Runs the tool's own login. Finish in your browser, then close this window.
            </DialogDescription>
          </DialogHeader>
          <div className="h-64 overflow-hidden rounded-lg border border-border">
            {fixing && <TerminalView sessionId={null} command={fixing.fix?.command} />}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void closeFix()}>Done, re-check</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
