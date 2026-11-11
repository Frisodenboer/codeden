import type { UpdateStatus } from "@codeden/contracts";
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  dismissUpdate,
  updateDismissed,
  updatedTo,
  useHandover,
  useHandoverStore,
  useUpdateActions,
  useUpdates,
} from "@/lib/updates";
import { cn } from "@/lib/utils";
import { WhatsNewDialog } from "./whats-new-dialog";

type Tone = "info" | "busy" | "done" | "warn";

const icons: Record<Tone, ReactNode> = {
  info: <ArrowUpCircle className="size-4 text-status-running" />,
  busy: <Loader2 className="size-4 animate-spin text-status-running" />,
  done: <CheckCircle2 className="size-4 text-status-done" />,
  warn: <AlertTriangle className="size-4 text-status-failed" />,
};

function Bar({
  tone,
  state,
  children,
  actions,
  onClose,
}: {
  tone: Tone;
  state: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="update-banner"
      data-state={state}
      className={cn(
        "mx-3 mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs",
        tone === "warn" && "border-status-failed/40",
      )}
    >
      {icons[tone]}
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      {onClose && (
        <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={onClose}>
          <X />
        </Button>
      )}
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
);

/**
 * The self-update banner (§16): a newer version on open ("What's new · Update now · Later"),
 * then install progress, the restart hand-over and failures with Retry. Non-blocking: it sits
 * above the page and never takes focus.
 */
export function UpdateBanner() {
  const { data } = useUpdates();
  const actions = useUpdateActions();
  const phase = useHandoverStore((s) => s.phase);
  const handoverTarget = useHandoverStore((s) => s.target);
  const [notesOpen, setNotesOpen] = useState(false);
  const [hidden, setHidden] = useState<string | null>(null);
  useHandover(data);
  if (!data) return null;
  const install = () => actions.install.mutate();
  const requestError = actions.install.error ?? actions.restart.error;

  const view = bannerView(data, phase, handoverTarget);
  if (!view || hidden === view.key) return null;
  const later = () => {
    if (data.latest) dismissUpdate(data.latest);
    setHidden(view.key);
  };

  switch (view.kind) {
    case "updated":
      return (
        <Bar tone="done" state="updated" onClose={() => setHidden(view.key)}>
          <span className="font-medium">CodeBench updated to {view.version}.</span>{" "}
          <span className="text-muted-foreground">
            Running sessions carry on where they left off.
          </span>
        </Bar>
      );
    case "handover":
      return (
        <Bar tone="busy" state="restarting">
          Updating CodeBench to {view.version}... restarting. This page reloads when it is back.
        </Bar>
      );
    case "timeout":
      return (
        <Bar tone="warn" state="timeout" onClose={() => setHidden(view.key)}>
          Update installed. Restart CodeBench to finish: <Code>{data.restartCommand}</Code>
        </Bar>
      );
    case "installing":
      return (
        <Bar tone="busy" state="installing">
          <span className="font-medium">Installing CodeBench {view.version}...</span>{" "}
          <span className="truncate text-muted-foreground" data-testid="update-progress">
            {data.progress}
          </span>
        </Bar>
      );
    case "failed":
      return (
        <Bar
          tone="warn"
          state="failed"
          onClose={() => setHidden(view.key)}
          actions={
            canUpdate(data) && (
              <Button size="xs" onClick={install} disabled={actions.install.isPending}>
                Retry
              </Button>
            )
          }
        >
          Couldn't update to {view.version}: {data.installError}
        </Bar>
      );
    case "installed":
      return data.canRestart ? (
        <Bar
          tone="done"
          state="installed"
          onClose={() => setHidden(view.key)}
          actions={
            <Button size="xs" onClick={() => actions.restart.mutate()}>
              Restart now
            </Button>
          }
        >
          CodeBench {view.version} is installed and starts the next time you open CodeBench.
        </Bar>
      ) : (
        <Bar tone="done" state="installed" onClose={() => setHidden(view.key)}>
          Update installed. Restart CodeBench to finish: <Code>{data.restartCommand}</Code>
        </Bar>
      );
    case "available":
      return (
        <>
          <Bar
            tone="info"
            state="available"
            onClose={later}
            actions={
              <>
                <Button size="xs" variant="ghost" onClick={() => setNotesOpen(true)}>
                  What's new
                </Button>
                {canUpdate(data) && (
                  <Button size="xs" onClick={install} disabled={actions.install.isPending}>
                    Update now
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={later}>
                  Later
                </Button>
              </>
            }
          >
            <span className="font-medium">CodeBench {view.version} is available.</span>{" "}
            <span className="text-muted-foreground">
              {data.source === "source"
                ? "You're running from source: pull and rebuild to update."
                : `You're on ${data.current}. Updating takes a moment and restarts CodeBench.`}
            </span>
            {requestError && (
              <span className="ml-1 text-status-failed">{requestError.message}</span>
            )}
          </Bar>
          <WhatsNewDialog
            version={view.version}
            open={notesOpen}
            onOpenChange={setNotesOpen}
            onUpdate={canUpdate(data) ? install : undefined}
          />
        </>
      );
  }
}

/** The server can install updates itself: an npm install or the desktop app (not a checkout). */
export function canUpdate(data: UpdateStatus): boolean {
  return data.source !== "source";
}

interface BannerView {
  kind: "updated" | "handover" | "timeout" | "installing" | "failed" | "installed" | "available";
  version: string;
  key: string;
}

/** Which banner (if any) the status calls for; `key` identifies it for "dismiss". */
export function bannerView(
  data: UpdateStatus,
  phase: "idle" | "waiting" | "timeout",
  handoverTarget: string | null,
): BannerView | null {
  const version = data.target ?? data.latest ?? data.current;
  const make = (kind: BannerView["kind"], v = version) => ({
    kind,
    version: v,
    key: `${kind}:${v}`,
  });
  if (phase === "timeout" && handoverTarget) return make("timeout", handoverTarget);
  if (phase === "waiting" && handoverTarget) return make("handover", handoverTarget);
  if (data.state === "restarting") return make("handover");
  if (data.state === "installing") return make("installing");
  if (data.state === "failed") return make("failed");
  if (data.state === "installed") return make("installed");
  if (updatedTo && updatedTo === data.current) return make("updated", updatedTo);
  if (data.updateAvailable && data.latest && !updateDismissed(data.latest)) {
    return make("available", data.latest);
  }
  return null;
}
