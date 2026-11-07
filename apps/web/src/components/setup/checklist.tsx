import type { SetupCheck, SetupStatus } from "@codeden/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Download,
  Loader2,
  LogIn,
  RefreshCw,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
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
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";

type RowState = SetupCheck["state"] | "checking";

/** Placeholder rows while the first detection runs. */
const PENDING: { id: string; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gh", label: "GitHub CLI" },
  { id: "git", label: "git identity" },
  { id: "browser", label: "Browser for agents" },
];

const PROVIDERS = new Set(["claude", "codex"]);

const fixLabel: Record<NonNullable<SetupCheck["fix"]>["kind"], string> = {
  install: "Install",
  login: "Sign in",
  upgrade: "Upgrade",
  configure: "Set up",
};

function StateIcon({ state }: { state: RowState }) {
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

/** Live setup status, shared by the checklist and the setup page's Continue button. */
export function useSetupStatus() {
  const client = useClient();
  return useQuery({ queryKey: ["setup"], queryFn: () => client.getSetupStatus() });
}

/** First-run checklist (§14): parallel checks with live ticks; one fix per failed check. */
export function SetupChecklist() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [fixing, setFixing] = useState<SetupCheck | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const { data } = useSetupStatus();

  const recheck = async (focus?: SetupCheck) => {
    setRechecking(true);
    try {
      const next = await client.getSetupStatus({ refresh: true });
      queryClient.setQueryData<SetupStatus>(["setup"], next);
      const after = focus && next.checks.find((c) => c.id === focus.id);
      if (focus && after?.state === "ok") toast.success(`${focus.label} is ready`);
    } catch (e) {
      toast.error("Couldn't re-check", { description: (e as Error).message });
    } finally {
      setRechecking(false);
    }
  };
  const closeFix = () => {
    const check = fixing;
    setFixing(null);
    if (check) void recheck(check);
  };

  const rows: { id: string; label: string; check?: SetupCheck }[] = data
    ? data.checks.map((c) => ({ id: c.id, label: c.label, check: c }))
    : PENDING;

  return (
    <>
      <div
        className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        data-testid="setup-checklist"
      >
        {rows.map(({ id, label, check: c }) => {
          const state: RowState = !c || rechecking ? "checking" : c.state;
          return (
            <div key={id} className="flex items-center gap-3 px-4 py-3" data-check={id}>
              <StateIcon state={state} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  {label}
                  {PROVIDERS.has(id) ? (
                    <span className="text-3xs font-normal text-muted-foreground">provider</span>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "truncate text-2xs",
                    state === "missing" || state === "error"
                      ? "text-status-failed/90"
                      : "text-muted-foreground",
                  )}
                >
                  {state === "checking" ? "Checking…" : c?.message}
                </div>
              </div>
              {c?.fix && state !== "ok" && state !== "checking" && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    className="max-w-56 font-mono text-muted-foreground"
                    title={c.fix.command}
                    onClick={() =>
                      void platform
                        .writeClipboard(c.fix?.command ?? "")
                        .then(() => toast("Command copied"))
                    }
                  >
                    <Copy /> <span className="truncate">{c.fix.command}</span>
                  </Button>
                  <Button size="sm" onClick={() => setFixing(c)}>
                    {c.fix.kind === "login" ? (
                      <LogIn />
                    ) : c.fix.kind === "install" ? (
                      <Download />
                    ) : (
                      <Wrench />
                    )}
                    {fixLabel[c.fix.kind]}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-start gap-3">
        <p className="flex-1 text-2xs text-muted-foreground">
          CodeDen reuses your existing logins and never stores provider or GitHub credentials. At
          least one agent provider is required; GitHub is recommended.
        </p>
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground"
          disabled={rechecking}
          onClick={() => void recheck()}
        >
          <RefreshCw className={cn(rechecking && "animate-spin")} /> Re-check
        </Button>
      </div>
      <Dialog open={fixing !== null} onOpenChange={(o) => !o && closeFix()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {fixing?.fix ? fixLabel[fixing.fix.kind] : ""} · {fixing?.label}
            </DialogTitle>
            <DialogDescription>
              {fixing?.fix?.kind === "login"
                ? "Runs the tool's own login. Finish in your browser, then close this window."
                : "Runs the command in a terminal on this machine. Close this window when it's done."}
            </DialogDescription>
          </DialogHeader>
          <div className="h-64 overflow-hidden rounded-lg border border-border">
            {fixing && <TerminalView sessionId={null} command={fixing.fix?.command} ephemeral />}
          </div>
          <div className="flex items-center justify-between">
            {fixing?.fix?.url ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fixing.fix?.url && platform.openExternal(fixing.fix.url)}
              >
                Install guide
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={closeFix}>Done, re-check</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
