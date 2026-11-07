import { ConfigFilesView } from "./config-files-view";

/** Memory files of every provider (CLAUDE.md, rules, auto memory, AGENTS.md), edited in place. */
export function MemoryEditor({ projectId }: { projectId: string | null }) {
  return (
    <ConfigFilesView
      projectId={projectId}
      kinds={["memory", "rule", "auto_memory"]}
      emptyText="No memory files found."
    />
  );
}

/** Each provider's user and project skill folders (`<name>/SKILL.md`). */
export function SkillsView({ projectId }: { projectId: string | null }) {
  return (
    <ConfigFilesView
      projectId={projectId}
      kinds={["skill"]}
      create="skill"
      placeholder="Describe when the skill applies and the steps to follow…"
      emptyText="No skills yet. Create one to teach agents a repeatable workflow."
    />
  );
}

/** Claude subagents (`.claude/agents`) and Codex agents (`.codex/agents`). */
export function SubagentsView({ projectId }: { projectId: string | null }) {
  return (
    <ConfigFilesView
      projectId={projectId}
      kinds={["subagent"]}
      create="subagent"
      placeholder="Describe the subagent's role, tools and what it returns…"
      emptyText="No subagents yet."
    />
  );
}
