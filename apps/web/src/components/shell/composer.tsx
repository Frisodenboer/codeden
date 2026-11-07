import { ArrowUp, ChevronDown, Mic, Paperclip, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function Picker({ label, value }: { label: string; value: string }) {
  return (
    <Button variant="ghost" size="xs" className="text-muted-foreground" aria-label={label}>
      {value}
      <ChevronDown className="opacity-60" />
    </Button>
  );
}

/** Composer (§13): text, attachments, provider/model/effort/autonomy pickers, voice. */
export function Composer() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="rounded-2xl border border-border bg-card shadow-[0_8px_30px_-12px] shadow-black/30 transition-colors focus-within:border-primary/40">
        <Textarea
          placeholder="Ask the orchestrator to start a project, triage issues or build something…"
          className="min-h-20 resize-none border-0 bg-transparent px-4 pt-3.5 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Attach"
          >
            <Paperclip />
          </Button>
          <Picker label="Provider" value="Claude Code" />
          <Picker label="Model" value="Default model" />
          <Picker label="Effort" value="High" />
          <Button variant="ghost" size="xs" className="text-muted-foreground" aria-label="Autonomy">
            <ShieldCheck className="text-status-done" />
            Auto, risky asks
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Dictate"
            >
              <Mic />
            </Button>
            <Button size="icon-sm" className="rounded-full" aria-label="Send" disabled>
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
        Agents run locally through your own Claude Code and Codex logins.
      </p>
    </div>
  );
}
