import { Link } from "@tanstack/react-router";
import { Bot, FolderPlus, GitPullRequest, ListChecks, ShieldAlert, Sparkles } from "lucide-react";
import { IdeaBoard } from "@/components/orchestration/idea-board";
import { RoleChat } from "@/components/orchestration/role-chat";
import { ScheduledCard } from "@/components/orchestration/scheduled-card";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { useSnapshotData } from "@/lib/queries";
import { useComposerStore } from "@/stores/composer";
import { useUiStore } from "@/stores/ui";

const suggestions = [
  { icon: Sparkles, text: "What's going on across my projects?" },
  { icon: ListChecks, text: "Triage the open issues in my main project" },
  { icon: ShieldAlert, text: "Run a security audit across all projects" },
  { icon: GitPullRequest, text: "Which pull requests are waiting on me?" },
];

/** Suggestions that fill the composer; shared by the orchestrator and PM empty states. */
export function SuggestionGrid({
  draftKey,
  items,
}: {
  draftKey: string;
  items: { icon: typeof Bot; text: string }[];
}) {
  const setText = useComposerStore((s) => s.setText);
  const focus = useComposerStore((s) => s.focus);
  return (
    <div className="relative mt-8 grid w-full max-w-2xl grid-cols-2 gap-2">
      {items.map((s) => (
        <button
          key={s.text}
          type="button"
          onClick={() => {
            setText(draftKey, s.text);
            focus();
          }}
          className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3.5 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card hover:text-foreground"
        >
          <s.icon className="size-4 shrink-0 text-primary/80" />
          {s.text}
        </button>
      ))}
    </div>
  );
}

function ProjectsStrip() {
  const projects = useSnapshotData((s) => s.projects, []);
  const setAddProject = useUiStore((s) => s.setAddProjectOpen);
  return (
    <div className="relative mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-1.5">
      {projects.map((p) => (
        <Link
          key={p.id}
          to="/projects/$projectId"
          params={{ projectId: p.id }}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ProjectTile project={p} /> {p.name}
        </Link>
      ))}
      <button
        type="button"
        onClick={() => setAddProject(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <FolderPlus className="size-3.5" /> Add project
      </button>
    </div>
  );
}

function OrchestratorEmpty({ draftKey }: { draftKey: string }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow),transparent)]"
      />
      <div className="relative mb-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        <Bot className="size-6 text-primary" />
      </div>
      <h2 className="relative text-2xl font-semibold tracking-tight">What should we build?</h2>
      <p className="relative mt-2 max-w-md text-center text-sm text-muted-foreground">
        Talk to the orchestrator. It knows what's running in every project, hands work to project
        managers and keeps every step visible in GitHub.
      </p>
      <SuggestionGrid draftKey={draftKey} items={suggestions} />
      <ProjectsStrip />
    </div>
  );
}

/** The orchestrator chat, pinned at the top of the sidebar (§8.1). */
export function HomePage() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <RoleChat
        kind="orchestrator"
        projectId={null}
        empty={(draftKey) => <OrchestratorEmpty draftKey={draftKey} />}
      />
      {/* Top right, below the header; only where the left-aligned chat leaves room. */}
      <div className="absolute top-14 right-4 bottom-4 z-10 hidden w-72 flex-col gap-3 overflow-y-auto scroll-thin 2xl:flex">
        <ScheduledCard className="shrink-0" />
        <IdeaBoard className="shrink-0" />
      </div>
    </div>
  );
}
