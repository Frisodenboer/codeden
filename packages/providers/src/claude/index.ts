/**
 * Claude Code adapter (M1). Will use the Claude Agent SDK `query()` with streaming input and
 * `pathToClaudeCodeExecutable` pointing at the user's installed `claude` (§7.2):
 * - `canUseTool` -> approval_request items, mapped by autonomy level (§11.2)
 * - `parent_tool_use_id` -> subagent child threads
 * - CodeDen's MCP proxy injected via `mcpServers`
 *
 * TODO(M1): implement `ClaudeAdapter implements ProviderAdapter` in small modules
 * (detect.ts, session.ts, events.ts, approvals.ts, subagents.ts) with Replay fixtures.
 */
export const CLAUDE_PROVIDER_ID = "claude";
