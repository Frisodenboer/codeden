/**
 * Codex adapter (M1). Will start `codex app-server` and speak JSON-RPC (§7.2), with protocol
 * types generated from the installed Codex version:
 * - threads/turns/items -> normalized AgentEvents
 * - sandbox + approval policies mapped from autonomy levels (§11.2)
 * - CodeDen's MCP server injected through config overrides
 *
 * TODO(M1): implement `CodexAdapter implements ProviderAdapter` in small modules
 * (detect.ts, rpc.ts, session.ts, events.ts, approvals.ts) with Replay fixtures.
 */
export const CODEX_PROVIDER_ID = "codex";
