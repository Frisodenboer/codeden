# Plan: opencode as a CodeBench provider (GLM without workarounds)

Status: **phases 1–4 done** (branch `feature/opencode-provider`); project pushes pending · Written 2026-11-11 · Owner: CodeBench fork (`Frisodenboer/codeden`)

## Why

GLM models currently run through Claude Code with a rerouted endpoint: projects' `.claude/settings.json`
set `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and `ANTHROPIC_DEFAULT_*_MODEL=glm-5.3…`, with
the key in the git-ignored `.claude/settings.local.json`. That caused a day of 401s:

- agent worktrees got the endpoint without the key (fixed in `5259f44`: local config is copied);
- the stored Z.AI key was truncated (only the part before the dot), so every GLM call failed;
- "opus"/"sonnet" silently became GLM in those projects, which made model choice confusing.

opencode talks to Z.AI natively (`zai-coding-plan`, `zai`, `zhipuai`, `zhipuai-coding-plan`), so
GLM becomes a real provider next to Claude Code and Codex, and Claude Code can go back to Claude.

## What we know (checked 2026-11-11)

- `opencode` **1.18.30** is installed (`%APPDATA%\npm\opencode`), config in
  `~/.config/opencode/opencode.jsonc` (with plugins), logins in `~/.local/share/opencode/auth.json`.
- Logins: `opencode` and **`zai-coding-plan`** (full key, 49 chars). `opencode run -m
  zai-coding-plan/glm-5.3 "…"` answers correctly.
- Models via `zai-coding-plan`: `glm-5.3`, `glm-5.3-flash`, `glm-5.3-highspeed` (endpoint
  `https://api.z.ai/api/coding/paas/v4`).
- `opencode serve` runs a headless HTTP server (`--port 0`, `--hostname 127.0.0.1`, `--pure` to skip
  external plugins). The official client is `@opencode-ai/sdk` (sessions, prompts, an event stream,
  permission replies).
- CodeBench providers are adapters (`packages/providers/src/adapter.ts`): `detect()`,
  `capabilities()`, `models()`, `refreshModels()`, `openSession()` → a `ProviderSession` with
  `events`, `send`, `interrupt`, `respond`, `configure`, `setAutonomy`, `close`, `resumeToken`.
  Codex (`packages/providers/src/codex/`, ~2,100 lines) is the closest model: a local server process
  with a JSON-RPC protocol.

## Design

```
CodeBench runner
  └─ OpencodeAdapter ──(one per runner)──▶ opencode serve --hostname 127.0.0.1 --port 0
        └─ OpencodeSession (per CodeBench session)
              ├─ POST session / prompt / abort   (via @opencode-ai/sdk)
              ├─ event stream  ──▶ mapper ──▶ AgentEvent (CodeBench's normalized events)
              └─ permission.asked ──▶ CodeBench approvals / risk classifier ──▶ reply
```

- **One server per runner**, started lazily, restarted on crash, stopped with the runner. Each
  CodeBench session is an opencode session whose `directory` is the session's worktree.
- **Per-session config, never the user's file:** CodeBench passes its additions (the `codeden` MCP
  server, permissions, the system prompt section) through opencode's config overlay for that server
  (`OPENCODE_CONFIG_CONTENT` or the API), leaving `opencode.jsonc` and its plugins untouched.
- **Resume:** the opencode session id is the resume token.

## Phases

### Step 1: chat with GLM safely (phases 1–2)

**Phase 1: core provider**
1. `packages/providers/src/opencode/`
   - `detect.ts`: locate `opencode`, check version (minimum 1.18), list logins by provider name.
   - `process.ts`: spawn and supervise `opencode serve`; read the port it binds; health check.
   - `client.ts`: typed wrapper on `@opencode-ai/sdk` (create/get session, prompt, abort, events,
     permission reply).
   - `session.ts`: `ProviderSession` implementation: `send`, `interrupt`, `respond`, `configure`
     (model change), `close`, `resumeToken`.
   - `mapper.ts`: opencode message parts and events → `AgentEvent`: assistant text (streamed),
     reasoning, tool calls (bash, edit, write, read, grep, glob, webfetch, MCP), file changes,
     token usage (`contextTokens`, `contextWindow`), cost, errors (auth, quota, rate limit).
   - `models.ts`: model list from the server (`provider/model`, e.g. `zai-coding-plan/glm-5.3`),
     with context window sizes for the context meter.
2. Register in `packages/providers/src/registry.ts` (id `opencode`); capabilities set honestly
   (`resume`, `interrupt`, `approvals`, `mcp`, `images` as supported; `steer` likely false).
3. Web: opencode logo in `provider-logos.tsx`; GLM sessions keep the **GLM** model badge.

**Phase 2: CodeBench tools and permission levels**
4. Inject the `codeden` MCP server per session (remote HTTP, the same endpoint and token Claude and
   Codex use), so `report_progress`, `ask_user`, `add_follow_up`, `suggest_followups`, `finish` and
   the browser tools work.
5. Map autonomy levels onto opencode permissions (`edit`, `bash`, `webfetch`: allow / ask / deny):
   - **Read-only** (orchestrator, PMs): deny edit and write-capable bash, or run opencode's built-in
     `plan` agent; reads and read-only git allowed.
   - **Supervised**: ask for edits and commands → CodeBench approval cards.
   - **Auto**: every permission request goes through CodeBench's risk classifier; only risky ones
     reach the user.
   - **Full**: allow, except writes outside the worktree.
6. Add CodeBench's system prompt section (role, tools, follow-ups) to the session.

Acceptance for step 1: start an agent session on `opencode` + `zai-coding-plan/glm-5.3` in a test
project, have it edit a file, see the diff, approvals in Supervised, `add_follow_up` landing in
Follow-ups, interrupt and resume after a CodeBench restart.

### Step 2: fit and finish (phases 3–4)

**Phase 3: integration**
7. Model picker and **Settings → Providers**: opencode with its models; choosable per role
   (orchestrator, PM, agent) and per project default.
8. Context meter, cost and the usage pages from opencode's token and cost data.
9. **Open in CLI** for opencode sessions: `opencode --session <id>` in the session folder (check the
   exact resume flag).
10. Composer `/` menu: opencode's commands (from its config) via the server.

**Phase 4: clean-up and tests**
11. Projects: remove the Z.AI block from the 10 projects' `.claude/settings.json` (backup as
    `ZA_settings.json`; commit and push where the file is tracked: AdMiners, ParSherpa,
    RAG Chatbot). Claude Code then always runs Claude; GLM runs on opencode.
12. Tests:
    - mapper tests on recorded opencode event fixtures (like `codex-mapper.test.ts`);
    - `detect` tests (missing binary, old version, no login);
    - permission mapping tests per autonomy level;
    - an end-to-end test with a fake opencode server;
    - a manual real GLM session in a test project.
13. Docs: add opencode to `README.md` (requirements) and `docs/security.md` (how its permissions map).

## Risks and open points

- **API drift:** opencode ships often. Pin `@opencode-ai/sdk` to the tested version, enforce a
  minimum `opencode` version in `detect`, and keep the mapper tolerant of unknown event types.
- **Steering:** probably no way to add input to a running turn; messages queue instead.
- **Plugins:** the user's opencode plugins load in `serve` unless `--pure`. Decide per role (likely
  `--pure` for orchestrator and PMs, normal for agents).
- **Windows:** process spawning, paths with spaces (`C:\Claude Code Projects\…`) and stopping the
  server tree cleanly need explicit tests.
- **Keys:** CodeBench never reads or stores the Z.AI key; opencode keeps it in its own auth store.

## Size and order

About the size of the Codex provider (~2,000 lines plus tests). Build step 1 first (phases 1–2), try
it with real GLM sessions, then step 2 (phases 3–4).
