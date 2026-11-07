# Agent configuration

CodeDen has first-class editors for each provider's **own** configuration: memory files, skills, subagents and MCP servers. It never keeps a private copy. Edits are written to the native files in place, so they show up in the terminal CLI too, and changes you make in the terminal show up in CodeDen.

Open **Agents** from the sidebar or the command palette. It has four tabs: **Memory**, **Skills**, **Subagents** and **MCP servers**. Pick a project at the top to see its files next to your user-level ones.

![Reviewing a CLAUDE.md change before saving](images/agent-memory.png)

## What's covered

| | Claude Code | Codex |
|---|---|---|
| **Memory (user)** | `~/.claude/CLAUDE.md`, `~/.claude/rules/**/*.md` | `~/.codex/AGENTS.md` (and `AGENTS.override.md`) |
| **Memory (project)** | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, nested `CLAUDE.md` files, `.claude/rules/` | `AGENTS.md` files, including nested ones |
| **Auto memory** | `~/.claude/projects/<project>/memory/` (or `autoMemoryDirectory` from `~/.claude/settings.json`); shared by all of a project's worktrees | |
| **Skills** | `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/` | `~/.codex/skills`, `~/.agents/skills`, `.agents/skills` |
| **Subagents** | `~/.claude/agents/**/*.md`, `.claude/agents/` | `~/.codex/agents/*.toml`, `.codex/agents/` |
| **MCP servers** | user (`~/.claude.json`), local (per project, in `~/.claude.json`), project (`.mcp.json`) | user (`~/.codex/config.toml`) |

Nested scans skip dot-folders and build output.

## Editing safely

- **Diff before save.** Every save shows a diff of what will change, and you confirm it.
- **Backups.** Before any overwrite or delete, the old file (or skill folder) is copied to `~/.codeden/backups/agent-config/`.
- **No lost edits.** If the file changed on disk since you opened it (for example the agent or your terminal edited it), the save is refused instead of overwriting.
- **Atomic writes**, so a crash never leaves a half-written file.
- **Scoped.** The editors only reach known agent-config locations. Anything else, `.git`, credential files and `..` paths are refused.
- **Formatting is kept.** JSON files keep their indentation. In `~/.codex/config.toml` only the server's own `[mcp_servers.<name>]` block is replaced, so your comments and other settings stay byte for byte. Fields CodeDen doesn't know about are preserved.

New files start from a sensible template (a skill folder with `SKILL.md`, a subagent with its frontmatter, and so on).

## MCP servers

The **MCP servers** tab lists every server each provider will load, by scope, including CodeDen's own (`codeden`, read-only). Add, edit or remove a server per provider and scope:

- **stdio:** command, arguments, environment variables and working directory.
- **HTTP or SSE:** URL and headers (Codex can also take the name of an environment variable holding a bearer token).
- **Enabled:** switch a server off without deleting it.

Every change shows its diff first.

## What's loaded

For any session, **Details → What's loaded** shows which memory files, skills, subagents and MCP servers are actually in its context, computed the way each provider does it from the session's working directory:

- **Claude** walks every folder up from the working directory for `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules`, adds the auto-memory `MEMORY.md`, and the project's skills and subagents up to the repo root.
- **Codex** takes `AGENTS.override.md` or `AGENTS.md` in `~/.codex` and in each folder from the repo root down to the working directory.

It's the quickest way to answer "why did the agent do that?" when an old rule is still in play.

## CodeDen's own additions

CodeDen adds two things to every agent session and never writes them into your files:

- its **MCP server** (`codeden`), with the tools for the session's role, passed to the provider at start-up;
- a short **system-prompt section** explaining those tools (report progress, ask the user, open a PR, attach evidence, suggest follow-ups, finish).
