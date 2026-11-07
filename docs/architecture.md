# Architecture

A short tour of how CodeDen is put together. The full, locked design is in [DESIGN.md](DESIGN.md); the package READMEs ([server](../apps/server/README.md), [providers](../packages/providers/README.md), [runner browser](../apps/runner/src/browser/README.md)) go into implementation detail.

```
┌──────────────────────── Web UI (React SPA) ─────────────────────────┐
│ sidebar · chat · inbox · right panels (diff/files/browser/terminal) │
└───────────────┬──────────────────────────────────────▲──────────────┘
                │ HTTP + WebSocket                      │ live events (seq)
┌───────────────▼──────────────────────────────────────┴──────────────┐
│ SERVER  (long-lived, owns state)                                    │
│  SQLite event log + projections · orchestration (orchestrator, PMs) │
│  MCP endpoint /mcp (role-scoped) · scheduler · GitHub sync          │
│  inbox · settings · first-run setup · usage ledger · factory loop   │
└───────────────┬──────────────────────────────────────▲──────────────┘
                │ runner protocol over WebSocket        │ events + acks
┌───────────────▼──────────────────────────────────────┴──────────────┐
│ RUNNER  (next to the code)                                          │
│  provider adapters (Claude Agent SDK, codex app-server) · node-pty  │
│  Chromium over CDP · worktrees, checkpoints, git · MCP proxy        │
│  event journal                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Processes

- **Server.** The single owner of persistent state. It serves the UI, holds the database, runs the orchestrator and PM logic, hosts the MCP endpoint, schedules automations, runs the factory loop and syncs GitHub. It never starts agent processes itself, and it's started through one `startServer({ port, dataDir, token })` function with nothing platform-specific in it.
- **Runner.** Everything that has to sit next to the code: agent processes, terminals, the browser, worktrees and git. It's a separate, detached process the server starts on demand and finds again through a lock file (`~/.codeden/runner/runner.json`).
- **Surviving restarts.** A server restart doesn't touch running agents. The runner keeps events in a local journal until the server acknowledges them by sequence number, so nothing is lost while the server is away. On a version mismatch after an upgrade, the runner drains (finishes or pauses turns) and restarts, and sessions resume through each provider's resume support.

## Data

- **SQLite** through Node's built-in `node:sqlite` and Drizzle, in WAL mode, at `~/.codeden/codeden.db`.
- **Append-only event log.** Every agent action is an event (`seq`, session, type, payload, time). It's never pruned: it's the audit trail and the replay source.
- **Projections** (projects, sessions, turns, items, inbox, automations and runs, GitHub issues and PRs, the usage ledger, factory items) are written in the same transaction as their event, so they can be rebuilt from the log.
- **Realtime.** The UI loads a snapshot with the current `seq`, then subscribes to events after it over a WebSocket, and resumes from the last `seq` after a reconnect. Large tool outputs are fetched on demand.

## Agents

- **Provider adapters** in `packages/providers` turn each provider's protocol into one normalized event model: a thread of turns, each holding items (messages, reasoning, tool calls, plans, approvals, questions, subagents, notices).
  - **Claude Code** through the Claude Agent SDK, pointed at your installed `claude` binary so it inherits your login and settings.
  - **Codex** through `codex app-server` over JSON-RPC, with protocol types generated from the installed Codex.
  - **Fake** and **Replay** providers for deterministic tests and demos.
- **Honest capabilities.** Each adapter declares what it supports (resume, steer, interrupt, approvals, subagents, images, ...). The UI and orchestration read those flags and never branch on a provider's name.
- **The MCP path.** Agents call a local MCP proxy inside the runner (`http://127.0.0.1:<runnerPort>/mcp`), which forwards to the server's `/mcp` with the session's role-scoped token. One tool registry serves both the agents (over MCP) and the UI's API handlers, so they can't drift apart.

## Web UI

React 19 and Vite, Tailwind v4 and shadcn/ui, TanStack Router and Query, Zustand. The UI talks to the server only over HTTP and WebSocket, and platform features (notifications, folder picking, clipboard images) go through one bridge interface, which keeps a future desktop shell cheap.

## Repository layout

```
apps/
  server/     Hono server, database, orchestration, MCP tools, automations, factory, GitHub sync
  runner/     Runner process: adapter host, terminals, browser, git, MCP proxy, journal
  web/        React SPA
  cli/        The published `codeden` package (bundles server, runner and the built web app)
packages/
  contracts/  zod schemas for everything that crosses a boundary
  providers/  Provider adapters and image engines
docs/
```

Everything that crosses a boundary (events, runner protocol, WebSocket messages, settings, API shapes) is a zod schema in `packages/contracts`, validated on both sides.
