import { Bot, GitPullRequest, ListChecks, ShieldAlert, Sparkles } from "lucide-react";
import { Composer } from "@/components/shell/composer";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "./page-header";

const suggestions = [
  { icon: Sparkles, text: "Set up a new project from a GitHub repo" },
  { icon: ListChecks, text: "Triage the open issues in my main project" },
  { icon: ShieldAlert, text: "Run a security audit across all projects" },
  { icon: GitPullRequest, text: "Which pull requests are waiting on me?" },
];

/** Orchestrator chat (empty state in M0). */
export function HomePage() {
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> Orchestrator
          </span>
        }
        meta={
          <Badge variant="secondary" className="h-5 text-[10px]">
            Claude Code
          </Badge>
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow),transparent)]"
        />
        <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <Bot className="size-6 text-primary" />
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            What should we build?
          </h2>
          <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
            Talk to the orchestrator. It creates projects, hands work to project managers and keeps
            every step visible in GitHub.
          </p>
          <div className="mt-8 grid w-full grid-cols-2 gap-2">
            {suggestions.map((s) => (
              <button
                key={s.text}
                type="button"
                className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3.5 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card hover:text-foreground"
              >
                <s.icon className="size-4 shrink-0 text-primary/80" />
                {s.text}
              </button>
            ))}
          </div>
        </div>
        <Composer />
      </div>
    </>
  );
}
