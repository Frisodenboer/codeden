import { AlarmClock, ChevronRight, Gauge } from "lucide-react";
import { useState } from "react";
import type { FoldedMessage } from "@/lib/orchestration";
import { cn } from "@/lib/utils";

/**
 * The status digest (and notice list) CodeDen prepends to every message for the orchestrator
 * and PMs (§8.4), folded into a small disclosure instead of raw text.
 */
export function DigestDisclosure({ folded }: { folded: FoldedMessage }) {
  const [open, setOpen] = useState(false);
  if (!folded.status && !folded.updates) return null;
  const updates = folded.updates ? folded.updates.split("\n").length - 1 : 0;
  return (
    <div className="flex max-w-[80%] flex-col items-end" data-testid="digest-disclosure">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-border/70 bg-muted/30 px-2 text-3xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Gauge className="size-3" />
        Status sent to agent
        {updates > 0 && <span className="opacity-70">· {updates} updates</span>}
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <pre className="mt-1.5 max-h-80 w-full overflow-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-3xs leading-relaxed whitespace-pre-wrap text-muted-foreground scroll-thin">
          {[folded.status, folded.updates].filter(Boolean).join("\n\n")}
        </pre>
      )}
    </div>
  );
}

/** An automatic wake-up turn: a quiet divider instead of a user bubble. */
export function WakeLine({ folded }: { folded: FoldedMessage }) {
  return (
    <div className="flex flex-col items-center gap-1.5" data-testid="wake-line">
      <span className="inline-flex items-center gap-1.5 text-3xs text-muted-foreground">
        <AlarmClock className="size-3" /> Woken by new updates
      </span>
      <DigestDisclosure folded={folded} />
    </div>
  );
}
