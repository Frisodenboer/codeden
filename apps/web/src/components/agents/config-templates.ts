import type { AgentConfigLocator, AgentConfigProvider, AgentConfigScope } from "@codeden/contracts";

export type NewConfigKind = "skill" | "subagent";

/** Where a new skill or subagent is created, by provider and scope (each provider's own layout). */
export function newConfigLocation(
  kind: NewConfigKind,
  provider: AgentConfigProvider,
  scope: Exclude<AgentConfigScope, "local">,
  name: string,
  projectId: string | null,
): AgentConfigLocator {
  const root = scope === "user" ? "home" : "project";
  const projectPart = root === "project" ? { projectId: projectId ?? undefined } : {};
  if (kind === "skill") {
    const dir =
      provider === "claude"
        ? ".claude/skills"
        : scope === "user"
          ? ".codex/skills"
          : ".agents/skills";
    return { root, ...projectPart, path: `${dir}/${name}/SKILL.md` };
  }
  const dir = provider === "claude" ? ".claude/agents" : ".codex/agents";
  const ext = provider === "claude" ? "md" : "toml";
  return { root, ...projectPart, path: `${dir}/${name}.${ext}` };
}

/** Starting content for a new skill or subagent. */
export function newConfigTemplate(
  kind: NewConfigKind,
  provider: AgentConfigProvider,
  name: string,
  description: string,
): string {
  const desc = description.trim() || `What ${name} does and when to use it`;
  if (kind === "skill") {
    return `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nSteps the agent should follow when this skill applies.\n`;
  }
  if (provider === "claude") {
    return `---\nname: ${name}\ndescription: ${desc}\ntools: Read, Grep, Glob\n---\n\nYou are ${name}. Describe how this subagent works and what it returns.\n`;
  }
  return `name = "${name}"\ndescription = "${desc.replaceAll('"', '\\"')}"\ndeveloper_instructions = """\nDescribe how this agent works and what it returns.\n"""\n`;
}

/** Skill and subagent names: letters, digits, dashes and underscores. */
export const CONFIG_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
