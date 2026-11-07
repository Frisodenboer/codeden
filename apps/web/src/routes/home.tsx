import { Bot, GitPullRequest, ListChecks, ShieldAlert, Sparkles } from "lucide-react";
import { ThreadView } from "@/components/thread/thread-view";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrchestratorSession } from "@/lib/queries";
import { useComposerStore } from "@/stores/composer";

const suggestions = [
  { icon: Sparkles, text: "Set up a new project from a GitHub repo" },
  { icon: ListChecks, text: "Triage the open issues in my main project" },
  { icon: ShieldAlert, text: "Run a security audit across all projects" },
  { icon: GitPullRequest, text: "Which pull requests are waiting on me?" },
];

function OrchestratorEmpty({ sessionId }: { sessionId: string }) {
  const setText = useComposerStore((s) => s.setText);
  const focus = useComposerStore((s) => s.focus);
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow),transparent)]"
      />
      <div className="relative mb-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        <Bot className="size-6 text-primary" />
      </div>
      <h2 className="relative text-2xl font-semibold tracking-tight">What should we build?</h2>
      <p className="relative mt-2 max-w-md text-center text-sm text-muted-foreground">
        Talk to the orchestrator. It creates projects, hands work to project managers and keeps
        every step visible in GitHub.
      </p>
      <div className="relative mt-8 grid w-full max-w-2xl grid-cols-2 gap-2">
        {suggestions.map((s) => (
          <button
            key={s.text}
            type="button"
            onClick={() => {
              setText(sessionId, s.text);
              focus();
            }}
            className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3.5 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card hover:text-foreground"
          >
            <s.icon className="size-4 shrink-0 text-primary/80" />
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The orchestrator chat, pinned at the top of the sidebar (§8.1). */
export function HomePage() {
  const orchestrator = useOrchestratorSession();
  if (!orchestrator) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full max-w-2xl" />
      </div>
    );
  }
  return (
    <ThreadView
      sessionId={orchestrator.id}
      empty={<OrchestratorEmpty sessionId={orchestrator.id} />}
    />
  );
}
