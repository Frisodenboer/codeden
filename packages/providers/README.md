# @codeden/providers

Provider adapters behind one normalized interface (`ProviderAdapter` / `ProviderSession`, design §7). Every adapter emits only `AgentEvent`s from `@codeden/contracts`.

| Adapter | How | Notes |
|---|---|---|
| `claude` | Claude Agent SDK `query()` with streaming input, `pathToClaudeCodeExecutable` = the user's `claude` | SDK pinned to `0.3.318` (tested with Claude Code 2.1.318) |
| `codex` | `codex app-server` JSON-RPC over stdio | Types generated from Codex 0.160.1 into `src/codex/protocol/` |
| `fake` | Scripted, deterministic | Demos and tests |
| `replay` | Plays back recorded fixtures | Contract tests; never spawns a CLI |

`getProvider(id)` / `listProviders()` return the built-in real adapters. Each adapter also exposes `utilityModel()` for tool-less one-shots (§7.4). `ApprovalBroker` and the risky-action classifier (`src/policy/`) are provider-neutral.

## Scripts

```sh
pnpm --filter @codeden/providers test            # unit + replay contract tests (no live turns)
pnpm --filter @codeden/providers test:live       # live smoke tests against the installed CLIs (small cost)
pnpm --filter @codeden/providers record:claude   # re-record test/fixtures/claude-*.json
pnpm --filter @codeden/providers record:codex    # re-record test/fixtures/codex-*.json
pnpm --filter @codeden/providers codex:protocol  # regenerate src/codex/protocol from the installed codex
```

Fixtures replace the recording cwd with `<CWD>`, the session id with `<SESSION>` and the OS user name with `user`. `CODEDEN_RECORD_MODEL`, `CODEDEN_LIVE_CLAUDE_MODEL` and `CODEDEN_LIVE_CODEX_MODEL` override the models (Claude defaults to the `haiku` alias, Codex to the user's configured model).

## Autonomy mapping (§11.2)

| Level | Claude | Codex |
|---|---|---|
| supervised | `default` + PreToolUse hook forces every edit/command to ask | `untrusted`, workspace-write sandbox |
| auto | `acceptEdits` + hook asks only when the classifier flags a call | `on-request`, workspace-write, network off |
| full | `bypassPermissions` + hook asks only for writes outside the worktree | `never`, workspace-write, network on |

## Protocol gotchas

**Claude Agent SDK**
- `canUseTool` only fires for calls the permission flow would prompt for; reads, `acceptEdits` edits and settings allow rules never reach it. A PreToolUse hook returning `permissionDecision: "ask"` routes the call to `canUseTool` in every mode, including `bypassPermissions` (the SDK warns that `canUseTool` is shadowed, but hook asks still arrive). The classifier therefore runs in the hook.
- Agent/Task subagents run in the background by default: the tool result is `async_launched` immediately and completion arrives as `system/task_notification`, possibly after the parent turn's `result`. Subagent output only arrives as full messages (no `stream_event`s) and needs `forwardSubagentText: true`.
- Each streamed `assistant` message carries one content block and often arrives before `content_block_stop`; blocks are matched to stream items by message id and order.
- Thinking blocks come back with empty text plus a signature on current models; they map to `reasoning` items with `redacted: true`.
- `result.modelUsage` and `total_cost_usd` are cumulative for the whole query, so `usage.updated` reports session totals.
- Steering pushes another user message into the streaming input; the CLI folds it in at the next tool boundary. If it ran as its own turn, the first `result` has `queued_turn_count > 0`, and the CodeDen turn stays open until it is 0.
- Windows: the native installer provides `claude.exe`; npm `.cmd` shims are unwrapped to `node <cli.js>` (Node refuses to spawn `.cmd` without a shell). The SDK also installs a bundled platform binary as an optional dependency, which CodeDen never uses. The CLI keeps the cwd locked for a moment after `close()`.

**Codex app-server**
- One JSON message per line, no `jsonrpc` field. Server-to-client request ids start at `0`, so never test them for truthiness.
- `turn/start` responds before `turn/started` arrives; the turn is opened on whichever comes first.
- A thread has a single writer: `thread/resume` fails with "already has an active writer" while another app-server still holds it. `close()` waits for the process to exit, and resume retries briefly before failing with `resume_conflict`.
- MCP servers are injected with `config: { "mcp_servers.<name>": { url, http_headers } }` on `thread/start`/`thread/resume`. That goes over stdin, so tokens never appear on a command line.
- On Windows, commands are wrapped as `pwsh -Command '...'`; `commandActions` carries the readable command (and read/search classification).
- The npm `codex.cmd` shim runs a Node wrapper that spawns the vendored `codex.exe`; the adapter runs `node <codex.js> app-server` and kills the process tree with `taskkill /T`.
- Unknown keys in the user's `~/.codex/config.toml` produce `configWarning` notifications on every start; they are ignored.
- Collab subagents and plan mode are experimental in app-server and not surfaced, so `subagents` and `planMode` are `false` for Codex.
