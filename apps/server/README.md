# @codeden/server

The long-lived CodeDen server (design §4.1): Hono HTTP API and UI WebSocket, the SQLite event log and projections, the runner client, and the internal MCP endpoint.

## Internal MCP endpoint (§4.4, §8.3)

- `POST /mcp`: Streamable HTTP, stateless (one MCP server and transport per request), responses stream as SSE. Agents reach it through the runner's local proxy (`http://127.0.0.1:<runnerPort>/mcp`).
- **Auth:** a per-session bearer token (`cdm_...`), minted when a session starts or resumes, stored only as a SHA-256 hash (`mcp_tokens`), revoked when the session stops, completes or fails. The install token is not accepted here, and MCP tokens are not accepted by `/api`.
- **Registry:** one file per tool in `src/mcp/tools/`, declared with `defineTool({ name, description, roles, scope, input, alwaysLoad?, handler })`. Tools outside the caller's role are neither listed nor callable. Always-loaded tools carry `_meta["anthropic/alwaysLoad"] = true`.
- **Injection:** the launcher passes CodeDen's server (`codeden`) as a trusted HTTP MCP server, so Claude allows `mcp__codeden` tools and Codex runs them with `default_tools_approval_mode = "approve"`. Agent sessions also get a short CodeDen system-prompt section (`src/mcp/prompt.ts`).

| Tool | Roles | What it does |
|---|---|---|
| `report_progress` | agent | Sets `session.progress` |
| `ask_user` | agent, pm | Question in the transcript and inbox (see below) |
| `share_to_chat` | all | File or base64 image -> artifact under `<home>/artifacts`, shown as a `notice` item (`code: "shared_artifact"`) |
| `suggest_followups` | agent | 2-4 prompts -> `followups` item on the current turn |
| `finish` | agent | Structured `session.result` |

### How `ask_user` works with every provider

The question becomes a `user_question` item (`deferred: true`) in the current turn, which the projection mirrors into the inbox. The tool call waits up to 4 minutes (`askUserWaitMs`): an answer within that time is the tool's result. Otherwise it returns `pending`, the agent is told to finish what it can and end its turn, and the deferred question stays open after the turn ends. When the user answers later, the answer is sent to the session as a new user message (queued if a turn is running). This avoids depending on each provider's MCP tool timeout and on long-held HTTP requests.

## Tests

```sh
pnpm --filter @codeden/server test        # unit + integration (real runner, Fake provider)
pnpm --filter @codeden/server test:live   # real Claude and Codex sessions end to end (small cost)
```

Server tests run the runner without the real Claude/Codex adapters (`CODEDEN_BUILTIN_PROVIDERS=0`), so they never reach a live agent or the utility model.
