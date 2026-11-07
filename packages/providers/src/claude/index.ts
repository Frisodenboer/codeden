/**
 * Claude Code adapter: the Claude Agent SDK `query()` with streaming input, pointed at the
 * user's installed `claude` binary (§7.2).
 */
export { CLAUDE_PROVIDER_ID, ClaudeAdapter, type ClaudeAdapterOptions } from "./adapter";
export { CLAUDE_MIN_VERSION, detectClaude, parseClaudeAuthStatus } from "./detect";
export { ClaudeEventMapper } from "./mapper";
export { CLAUDE_UTILITY_MODEL, ClaudeUtilityModel } from "./one-shot";
export { ClaudePolicy, permissionModeFor } from "./permissions";
export * from "./sdk";
export { ClaudeSession } from "./session";
