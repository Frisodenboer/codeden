import { Bot, CircleDot, GitPullRequest, ListTodo, Workflow } from "lucide-react";
import { RoleChat } from "@/components/orchestration/role-chat";
import { useProject } from "@/lib/queries";
import { SuggestionGrid } from "./home";

const suggestions = [
  { icon: ListTodo, text: "What's running in this project right now?" },
  { icon: CircleDot, text: "Triage the open issues and tell me which are ready" },
  { icon: GitPullRequest, text: "Which pull requests need attention?" },
  { icon: Workflow, text: "Plan the next piece of work and start an agent on it" },
];

/** A project's PM chat (§8.1): triages, plans, starts and steers agent sessions. */
export function PmPage({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  if (!project) return null;
  return (
    <RoleChat
      kind="pm"
      projectId={projectId}
      empty={(draftKey) => (
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-10">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <Bot className="size-6 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{project.name} PM</h2>
          <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
            The project manager sees everything running in {project.name}, triages issues and starts
            agent sessions. It works read-only; agents make the changes.
          </p>
          <SuggestionGrid draftKey={draftKey} items={suggestions} />
        </div>
      )}
    />
  );
}
