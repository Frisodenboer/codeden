import type { McpServerEntry, MemoryFile, SkillEntry, SubagentEntry } from "../../types";
import { ago } from "./helpers";

const mem = (
  id: string,
  provider: string,
  scope: MemoryFile["scope"],
  label: string,
  path: string,
  sizeBytes: number,
  exists = true,
): MemoryFile => ({
  id,
  provider,
  scope,
  label,
  path,
  exists,
  sizeBytes,
  updatedAt: exists ? ago(60 * 30) : null,
});

export const memoryFiles: MemoryFile[] = [
  mem("m-claude-global", "claude", "global", "Global memory", "~/.claude/CLAUDE.md", 1840),
  mem("m-claude-project", "claude", "project", "Project memory", "CLAUDE.md", 2610),
  mem("m-claude-local", "claude", "local", "Local (not committed)", "CLAUDE.local.md", 0, false),
  mem(
    "m-claude-rule-tests",
    "claude",
    "project",
    "Rule · testing",
    ".claude/rules/testing.md",
    720,
  ),
  mem("m-claude-rule-ui", "claude", "project", "Rule · UI conventions", ".claude/rules/ui.md", 980),
  mem("m-codex-global", "codex", "global", "Global instructions", "~/.codex/AGENTS.md", 1210),
  mem("m-codex-project", "codex", "project", "Repo instructions", "AGENTS.md", 3320),
  mem("m-codex-nested", "codex", "project", "Nested · src/checkout", "src/checkout/AGENTS.md", 540),
];

export const configContents: Record<string, string> = {
  "CLAUDE.md": `# Storefront

React 19 + Vite storefront for Hearth & Co.

## Commands
- \`pnpm dev\` — app on http://localhost:5173
- \`pnpm test\` — unit tests (Vitest)
- \`pnpm test:e2e\` — Playwright, needs the dev server

## Conventions
- Prices are always computed server-side; never trust client totals.
- Components live next to their tests. Keep files under 300 lines.
- Use \`waitForResponse\` in e2e tests, never fixed sleeps.

## Protected areas
Changes under \`src/payments/\` and \`migrations/\` always need a human review.
`,
  "~/.claude/CLAUDE.md": `# Personal preferences

- Explain trade-offs briefly before large refactors.
- Prefer small, reviewable commits with conventional messages.
- Windows first: use cross-platform paths and scripts.
`,
  "AGENTS.md": `# Agent guide

See CLAUDE.md for commands. Additional notes for Codex sessions:

- Run \`pnpm typecheck && pnpm lint\` before finishing.
- Open draft PRs early and link the issue with \`Fixes #N\`.
`,
};

export const skills: SkillEntry[] = [
  {
    id: "sk-frontend",
    name: "frontend-design",
    description: "Distinctive, production-grade UI work with a design system",
    provider: "claude",
    scope: "global",
    path: "~/.claude/skills/frontend-design/SKILL.md",
    enabled: true,
  },
  {
    id: "sk-e2e",
    name: "playwright-e2e",
    description: "Write and debug Playwright end-to-end tests",
    provider: "claude",
    scope: "project",
    path: ".claude/skills/playwright-e2e/SKILL.md",
    enabled: true,
  },
  {
    id: "sk-migrations",
    name: "db-migrations",
    description: "Safe, reversible database migrations",
    provider: "claude",
    scope: "project",
    path: ".claude/skills/db-migrations/SKILL.md",
    enabled: false,
  },
  {
    id: "sk-release",
    name: "release-notes",
    description: "Draft release notes from merged PRs",
    provider: "codex",
    scope: "global",
    path: "~/.codex/skills/release-notes/SKILL.md",
    enabled: true,
  },
];

export const subagents: SubagentEntry[] = [
  {
    id: "sa-reviewer",
    name: "code-reviewer",
    description: "Reviews diffs against acceptance criteria and the project vision",
    provider: "claude",
    scope: "project",
    path: ".claude/agents/code-reviewer.md",
    model: "opus",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "sa-tests",
    name: "test-writer",
    description: "Adds focused tests for changed code paths",
    provider: "claude",
    scope: "global",
    path: "~/.claude/agents/test-writer.md",
    model: "sonnet",
    tools: ["Read", "Edit", "Bash"],
  },
  {
    id: "sa-explorer",
    name: "codebase-explorer",
    description: "Answers where-is-X questions quickly and cheaply",
    provider: "claude",
    scope: "global",
    path: "~/.claude/agents/codebase-explorer.md",
    model: "haiku",
    tools: ["Read", "Grep", "Glob"],
  },
];

export const mcpServers: McpServerEntry[] = [
  {
    id: "mcp-codeden",
    name: "codeden",
    transport: "http",
    target: "http://127.0.0.1:4319/mcp",
    source: "Built in",
    enabledFor: ["claude", "codex"],
    status: "connected",
    toolCount: 18,
  },
  {
    id: "mcp-playwright",
    name: "playwright",
    transport: "stdio",
    target: "npx @playwright/mcp --cdp-endpoint …",
    source: ".mcp.json",
    enabledFor: ["claude", "codex"],
    status: "connected",
    toolCount: 21,
  },
  {
    id: "mcp-linear",
    name: "linear",
    transport: "http",
    target: "https://mcp.linear.app/mcp",
    source: "~/.claude.json",
    enabledFor: ["claude"],
    status: "error",
    toolCount: null,
  },
  {
    id: "mcp-postgres",
    name: "postgres",
    transport: "stdio",
    target: "npx @modelcontextprotocol/server-postgres postgres://localhost/store",
    source: "~/.codex/config.toml",
    enabledFor: ["codex"],
    status: "unknown",
    toolCount: null,
  },
];
