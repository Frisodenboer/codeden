import type {
  AgentConfigFile,
  AgentConfigKind,
  AgentConfigProvider,
  AgentConfigScope,
  McpServerEntry,
} from "@codeden/contracts";
import { ago } from "./helpers";

const HOME = "C:\\Users\\you";
const REPO = "C:\\Code\\storefront";
const PROJECT = "p-storefront";

function file(
  provider: AgentConfigProvider,
  kind: AgentConfigKind,
  scope: AgentConfigScope,
  root: "home" | "project",
  path: string,
  extra: Partial<AgentConfigFile> = {},
): AgentConfigFile {
  const exists = extra.exists ?? true;
  const base = root === "home" ? HOME : REPO;
  return {
    root,
    projectId: root === "project" ? PROJECT : undefined,
    path,
    provider,
    kind,
    scope,
    name: path.split("/").at(-1) ?? path,
    absolutePath: `${base}\\${path.replaceAll("/", "\\")}`,
    exists,
    sizeBytes: exists ? 900 + path.length * 37 : 0,
    modifiedAt: exists ? ago(60 * 5) : null,
    ...extra,
  };
}

/** Discovered agent-config files of the mock world (`GET /api/agent-config/files`). */
export const configFiles: AgentConfigFile[] = [
  file("claude", "memory", "user", "home", ".claude/CLAUDE.md"),
  file("claude", "memory", "project", "project", "CLAUDE.md"),
  file("claude", "memory", "local", "project", "CLAUDE.local.md", { exists: false }),
  file("claude", "rule", "project", "project", ".claude/rules/testing.md"),
  file("claude", "rule", "project", "project", ".claude/rules/ui.md"),
  file("codex", "memory", "user", "home", ".codex/AGENTS.md"),
  file("codex", "memory", "project", "project", "AGENTS.md"),
  file("codex", "memory", "project", "project", "src/checkout/AGENTS.md", { onDemand: true }),
  file("claude", "skill", "user", "home", ".claude/skills/frontend-design/SKILL.md", {
    name: "frontend-design",
    description: "Distinctive, production-grade UI work with a design system",
  }),
  file("claude", "skill", "project", "project", ".claude/skills/playwright-e2e/SKILL.md", {
    name: "playwright-e2e",
    description: "Write and debug Playwright end-to-end tests",
  }),
  file("codex", "skill", "user", "home", ".codex/skills/release-notes/SKILL.md", {
    name: "release-notes",
    description: "Draft release notes from merged PRs",
  }),
  file("claude", "subagent", "project", "project", ".claude/agents/code-reviewer.md", {
    name: "code-reviewer",
    description: "Reviews diffs against acceptance criteria and the project vision",
  }),
  file("claude", "subagent", "user", "home", ".claude/agents/test-writer.md", {
    name: "test-writer",
    description: "Adds focused tests for changed code paths",
  }),
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
  ".claude/CLAUDE.md": `# Personal preferences

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

/** Configured MCP servers (`GET /api/agent-config/mcp`). */
export const mcpServers: McpServerEntry[] = [
  {
    provider: "codeden",
    scope: "user",
    name: "codeden",
    spec: { type: "http", url: "http://127.0.0.1:4319/mcp" },
    file: "(built in)",
    projectId: null,
  },
  {
    provider: "claude",
    scope: "project",
    name: "playwright",
    spec: { type: "stdio", command: "npx", args: ["@playwright/mcp@latest"] },
    file: `${REPO}\\.mcp.json`,
    projectId: PROJECT,
  },
  {
    provider: "claude",
    scope: "user",
    name: "linear",
    spec: { type: "http", url: "https://mcp.linear.app/mcp" },
    file: `${HOME}\\.claude.json`,
    projectId: null,
  },
  {
    provider: "codex",
    scope: "user",
    name: "postgres",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["@modelcontextprotocol/server-postgres", "postgres://localhost/store"],
    },
    file: `${HOME}\\.codex\\config.toml`,
    projectId: null,
  },
];
