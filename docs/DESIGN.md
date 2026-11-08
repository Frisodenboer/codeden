# CodeDen: Design

> Status: **locked for v1**, 2026-11-07. Changes to anything in "Locked decisions" need an explicit design discussion and an update to this file. The desktop app (§17) was approved on 2026-11-08.

## 1. What CodeDen is

CodeDen is a local-first harness for coding agents (Claude Code and Codex at launch, more later). Lead with this: a beautiful, streamlined coding harness that can also run a small software factory on autopilot. Every piece of work stays visible and traceable in GitHub.

- **Orchestrator.** One high-level agent you talk to. It creates projects and hands work to project managers.
- **Project Managers (PMs).** One long-lived agent per project. It triages GitHub issues, starts agent sessions, follows their progress, and escalates to you when unsure.
- **Agent sessions.** Coding agents, each in its own git worktree and branch. They open pull requests, attach test evidence, and ask you questions.
- **Inbox.** One place for everything waiting on you: questions, approvals, PRs ready for review, failed runs, triage decisions.
- **Automations.** Toggleable background work such as security audits, refactor sweeps, dependency updates, UI reviews and issue triage. Ships with templates; users add their own.
- **Workbench.** An integrated terminal, a browser the agents can drive, diffs, files, and first-class editing of agent memory files, skills, subagents and MCP servers.
- **Voice.** Dictation into the composer, and read-aloud of an agent's final message.
- **Image generation for every agent.** A Claude agent can create images too. One `generate_image` tool routes to whichever engine you chose in Settings (Codex, Gemini, OpenAI).
- **Follow-up prompts.** When an agent finishes, CodeDen suggests the next prompts as one-click chips.

Installed with `npx codeden`, or as the desktop app (§17). Open source under the MIT license. No accounts, no license checks, no hosted backend.

## 2. Principles

1. **Visible, not magic.** Every agent action is an event you can see, replay and trace to an issue, branch or PR. Nothing important happens off-screen.
2. **Native files are the source of truth.** CodeDen reads and writes each provider's own config (`CLAUDE.md`, `AGENTS.md`, skills, subagents, `.mcp.json`, `~/.codex/config.toml`) instead of keeping a private copy. Edits in CodeDen show up in the terminal CLI, and the other way round.
3. **Inherit, don't re-ask.** Existing Claude Code, Codex, GitHub and git setups are detected and reused. CodeDen never asks for a credential it can already use.
4. **SDKs and protocols, never scraped CLI output.**
5. **Honest capabilities.** Each provider declares what it supports. The UI and orchestration read those flags and never branch on a provider's name, and never pretend to enforce something the provider can't.
6. **Everything automatic can be switched off.** Automations, triage, auto-PRs and read-aloud are all opt-in or toggleable, globally and per project.
7. **Lean.** Plain TypeScript, few packages, few native dependencies, small modules. Most code will be written by coding agents, so mainstream patterns beat clever ones.
8. **Survive restarts.** Agents keep working when the server restarts. Every session can be resumed.

## 3. Locked decisions

| Area | Decision |
|---|---|
| Distribution | Two ways, one codebase and one data folder: `npx codeden` starts a local server and opens the browser; the **desktop app** (Electron, §17) starts or attaches to the same server and loads the same UI, installed from GitHub Releases (NSIS, dmg/zip, AppImage/deb) and updated by electron-updater |
| License / business | Fully open source (MIT). No accounts or license gating |
| Language | Plain TypeScript (strict), ESM. No Effect |
| Runtime | Node.js **24+** |
| Repo | pnpm workspace, about five packages (§5), published as one `codeden` npm package |
| Server | Hono on `@hono/node-server`, with WebSockets via `@hono/node-ws` |
| Database | SQLite through the built-in `node:sqlite` and Drizzle (`drizzle-orm/node-sqlite`), WAL mode |
| Web UI | React 19 + Vite single-page app; Tailwind v4 + shadcn/ui; TanStack Router + TanStack Query; Zustand. **Not Next.js** |
| API typing | Hono typed RPC client for HTTP; shared zod schemas for the WebSocket event model |
| Agents | Claude Code through the **Claude Agent SDK**, using the user's installed `claude` binary. Codex through **`codex app-server`** (JSON-RPC, with types generated from the installed Codex). OpenCode (official SDK) and a generic **ACP** adapter come after v1 |
| Agent ↔ app | One internal **MCP server** (Streamable HTTP) with **role-scoped tokens** (orchestrator, PM, agent) |
| Process model | **Server and runner are separate processes** from day one (§4) |
| Terminal | node-pty in the runner, xterm.js in the UI |
| Browser | Chromium driven through CDP (playwright-core) in the runner, streamed into the UI. Uses the installed Edge or Chrome when present |
| Default autonomy | **Auto, risky actions ask** (§11.2). Overridable per project and per session |
| Image generation | A pluggable `generate_image` tool available to every agent. Engines: Codex (the default when Codex is logged in), Gemini image models, OpenAI Images. Chosen in Settings (§12.5) |
| Utility model | One small, cheap model setting for side jobs: follow-up suggestions, read-aloud summaries, session titles (§7.4) |
| v1 scope | The full vision: daily driver, orchestration, automations (§19) |
| Projects | GitHub repos get the full issue/PR/evidence flow. **Local-only folders are supported** without the GitHub features |
| Forges | GitHub only in v1 |
| Platforms | Windows, macOS and Linux. **Windows is tested first** |
| Tooling | Biome (lint and format), tsdown (bundling), Vitest, Playwright (end-to-end) |

## 4. Architecture

```
┌──────────────────────── Web UI (React SPA) ─────────────────────────┐
│ sidebar · chat · inbox · right panels (diff/files/browser/terminal) │
└───────────────┬──────────────────────────────────────▲──────────────┘
                │ HTTP (Hono RPC) + WebSocket          │ live events (seq)
┌───────────────▼──────────────────────────────────────┴──────────────┐
│ SERVER  (long-lived, owns state)                                    │
│  SQLite event log + projections · orchestration (orchestrator, PMs) │
│  MCP endpoint /mcp (role-scoped) · scheduler · GitHub sync          │
│  inbox · settings · first-run setup · static UI hosting             │
└───────────────┬──────────────────────────────────────▲──────────────┘
                │ runner protocol over WebSocket        │ events + acks
┌───────────────▼──────────────────────────────────────┴──────────────┐
│ RUNNER  (next to the code; local process now, remote box later)     │
│  provider adapters (Claude SDK, Codex app-server, …) · node-pty     │
│  Chromium/CDP · worktree + git ops · local MCP proxy · event journal│
└──────────────────────────────────────────────────────────────────────┘
```

### 4.1 Server

The server is the single owner of persistent state. It never starts agent processes itself. It:

- serves the UI;
- holds the database;
- runs the orchestrator and PM logic;
- hosts the MCP endpoint;
- schedules automations;
- syncs GitHub;
- talks to one or more runners.

It's started through a single `startServer({ port, dataDir, token })` function and never imports anything platform-specific. That keeps the Electron path open.

### 4.2 Runner

The runner hosts everything that has to sit next to the code: agent processes (through provider adapters), terminals, the browser, and worktree and git operations.

- **Local today.** It's a separate, detached process that the server starts on demand. It's found again through a lock file in the data directory holding its port, token, PID and version.
- **Survives server restarts.** A server restart (crash, update, dev reload) doesn't touch running agents. The server reconnects and catches up.
- **Event journal.** The runner keeps events locally until the server acknowledges them by sequence number, so nothing is lost while the server is away.
- **Upgrades.** On a version mismatch, the runner drains. It finishes or pauses turns, then restarts. Sessions are resumed through their provider's resume support, with an automatic "you were interrupted, continue" message when a turn was cut off.
- **Remote later.** The same runner package can run inside an Upstash Box, a VPS or a container and connect back over the same protocol. That's the seam for the software factory; no remote backend ships in v1.

### 4.3 Runner protocol

A versioned, zod-typed message protocol over one WebSocket:

- **Server → runner commands:** `workspace.prepare`, `session.start`, `session.send`, `session.steer`, `session.interrupt`, `session.respond` (approval or answer), `session.stop`, `pty.*`, `browser.*`, `git.*`.
- **Runner → server events:** normalized agent events (§7.3), process status, terminal output, browser frames. Each event carries a monotonically increasing `seq`, which the server acknowledges. Provider lists (with each provider's models) are sent at the handshake and again whenever a list changes, for example once model discovery finishes.
- **Handshake:** the protocol version, runner version and capabilities are exchanged on connect.

### 4.4 MCP access path

Agents always call a **local MCP proxy inside the runner** (`http://127.0.0.1:<runnerPort>/mcp`). The proxy forwards to the server's `/mcp` over the runner connection, with the session's scoped token. Locally and remotely, agents see the same localhost address and nothing extra is exposed.

## 5. Repository layout

```
codeden/
  apps/
    server/     Hono server, DB, orchestration, MCP tools, scheduler, GitHub sync
    web/        React SPA
    runner/     runner process: adapters host, pty, browser, git, MCP proxy, journal
    desktop/    the desktop app (§17): Electron main, preload bridge, server host, packaging
    cli/        the published `codeden` package (CLI entry, bundles server + runner + web)
  packages/
    contracts/  zod schemas: event model, runner protocol, WS messages, settings
    providers/  provider adapters (claude, codex, later opencode, acp, fake, replay)
  docs/
```

The published `codeden` npm package bundles the server, runner and CLI with tsdown, and includes the prebuilt web assets. Permissively licensed pure-JS dependencies are inlined (their licenses ship in `dist/THIRD-PARTY-NOTICES.txt`), so `npx codeden` installs only the native modules and `playwright-core`. The **Claude Agent SDK is not redistributed**: on first use it is installed from npm into `~/.codeden/deps/` with `--omit=optional --omit=peer` (about 5 MB; its platform binaries are never needed because the adapter runs the user's installed `claude`, and its JS entry needs no peers). A lock file keeps the server and runner from installing it twice; in the workspace it resolves from `node_modules` instead.

## 6. Data and persistence

- **Data directory:** `~/.codeden/`, overridable with `CODEDEN_HOME`. Two copies (for example a development build next to your stable copy) can run side by side with different homes and ports.
  - `codeden.db`: the SQLite database.
  - `settings.json`: user settings, non-secret.
  - `runner/`: the runner lock file and event journal.
  - `wt/<project>/<session>/`: git worktrees. Short paths, to stay clear of Windows path-length limits.
  - `artifacts/`: screenshots and files shared in chat.
  - `logs/`
- **Secrets** (an optional ElevenLabs key, API keys if a user chooses that mode) live in the **OS keychain** through `@napi-rs/keyring`, never in files. GitHub and provider credentials are inherited at runtime, not stored (§14).
- **Event log.** Append-only `events` table (`seq`, `session_id`, `type`, `payload`, `ts`). **It's never pruned**: it's the audit trail and the replay source.
- **Projections.** `projects`, `sessions`, `threads`, `turns`, `items`, `inbox_items`, `automations`, `automation_runs`, `github_issues`, `github_prs`, `artifacts`. They're written in the same transaction as the event that produces them, so they can be rebuilt from the log.
- **Migrations.** Drizzle migrations from the first commit.
- **Realtime to the UI.** The client loads a snapshot that includes the current `seq`, then subscribes to events after it over the WebSocket. On reconnect it resumes from the last `seq` it saw. Large tool outputs are fetched on demand rather than pushed.

## 7. Agents and providers

### 7.1 Adapter interface

Each provider is an adapter in `packages/providers`, loaded by the runner:

```ts
interface ProviderAdapter {
  id: "claude" | "codex" | string;
  detect(): Promise<ProviderStatus>;          // installed? version? logged in? (§14)
  capabilities(): ProviderCapabilities;
  openSession(opts: SessionOptions): Promise<ProviderSession>;
}

interface ProviderSession {
  events: AsyncIterable<AgentEvent>;          // normalized (§7.3)
  send(input: UserInput): Promise<void>;      // starts a turn
  steer?(input: UserInput): Promise<void>;    // inject into a running turn
  interrupt(): Promise<void>;
  respond(requestId: string, response: RuntimeResponse): Promise<void>; // approvals, questions
  close(): Promise<void>;
  resumeToken(): string | undefined;          // provider session/thread id for resume
}
```

**`ProviderCapabilities` flags:** `resume`, `steer`, `interrupt`, `approvals`, `userQuestions`, `subagents`, `rollback`, `fork`, `images`, `planMode`, `reasoningEffort`, `mcp`, `skills`.

### 7.2 Providers

- **Claude Code.** Uses the Claude Agent SDK `query()` with streaming input:
  - **Binary:** `pathToClaudeCodeExecutable` points at the user's installed `claude`, which inherits their login and settings.
  - **Approvals:** `canUseTool` maps to approvals, and `resume` handles sessions.
  - **Subagents:** messages tagged with `parent_tool_use_id` become child threads.
  - **CodeDen tools:** CodeDen's MCP proxy is passed in through `mcpServers`.
  - **Versions:** the SDK version is pinned to one we've tested against.
- **Codex.** Starts `codex app-server` and speaks JSON-RPC:
  - **Methods:** threads, turns, items, approvals and steering.
  - **Types:** protocol types are generated from the installed Codex version.
  - **Permissions:** sandbox and approval policies map onto CodeDen's autonomy levels (§11.2).
  - **CodeDen tools:** the MCP server is injected through config overrides.
- **Fake and Replay** (development and tests only):
  - **Fake** is a scripted provider for demos and deterministic tests.
  - **Replay** plays back sessions recorded from the real CLIs, so the test suite never pays for agent turns.
- **After v1:** OpenCode through its official SDK, and a generic ACP adapter that opens up the long tail of ACP-speaking agents.

### 7.3 Normalized event model

A conversation is a **thread** made of **turns**, and each turn holds **items**. Agent events:

- **Session and turn lifecycle:** `session.updated`, `turn.started`, `turn.completed`, `turn.failed`, `turn.interrupted`.
- **Items:** `item.started`, `item.delta`, `item.completed`. Item kinds:
  - `user_message`, `assistant_message`, `reasoning`
  - `tool_call`, with a `toolKind` of `command`, `file_edit`, `file_read`, `search`, `web`, `mcp`, `browser` or `other`
  - `plan` / `todo_list`
  - `approval_request`, `user_question`
  - `subagent` (links to a child thread)
  - `notice`, `error`
- **Usage:** `usage.updated` (tokens, cost where reported, rate-limit state).

**Subagents** are child threads with `parentThreadId` and `parentItemId`. The parent transcript shows a compact subagent card with live status. Clicking it opens the child thread in a side panel or as its own view, and approvals raised inside a subagent surface in the parent and in the inbox.

### 7.4 Utility model

Small side jobs use one configurable **utility model**, so they never need a separate API key:

- **The jobs:** follow-up prompt suggestions (§13), compressing a final message for read-aloud (§11.3), session titles, and short summaries in notices.
- **How it runs:** a one-shot call through an installed provider with no tools. The default is a small Claude model through the Agent SDK, or a small Codex model when only Codex is set up.
- **Controls:** the model is chosen in Settings, and each job can be switched off.

### 7.5 Follow-up prompts

When a turn completes, CodeDen offers two to four suggested next prompts:

- **Primary source:** the agent calls `suggest_followups` as its last action. CodeDen's system prompt asks it to, and the agent has the full context at no extra cost.
- **Fallback:** when the agent didn't call the tool, the utility model proposes follow-ups from the final message and the turn's changes.
- **In the UI:** suggestions are stored as an item on the turn and shown as chips above the composer. A click fills the composer for editing; a setting makes it send straight away.
- **PMs** can read an agent's follow-ups when deciding what to do next.

## 8. Orchestration

### 8.1 Roles

All three roles are the same kind of agent session, differing only in **role**, **system prompt**, **working directory** and **tool set**. Each can run on any provider. Claude Code is the default for the orchestrator and PMs, and each role can be switched to another provider.

| Role | Count | Works in | Purpose |
|---|---|---|---|
| Orchestrator | 1 | `~/.codeden/orchestrator/` | Your front door. Creates and configures projects, routes requests to PMs, summarises status across projects |
| Project Manager | 1 per project | Read-only view of the repo | Triages issues, plans work, starts and steers agent sessions, reviews results, escalates to you |
| Agent | many | Its own worktree and branch | Does the work: code, tests, PRs, evidence |

### 8.2 How work flows

1. **Work arrives.** You ask the orchestrator, a PM picks up a GitHub issue, or an automation fires.
2. **The PM starts an agent session.** It names a provider, model, issue link and brief; CodeDen creates the worktree and branch, then starts the session on the runner.
3. **The agent works.** It may ask questions (inbox), request approvals (inbox), share screenshots, and finally opens a PR with evidence linked to the issue.
4. **Notices wake the PM.** Session events become **typed notices** (`session.finished`, `session.needs_input`, `pr.opened`, `pr.checks_failed`, …). They're batched and debounced, and wake the PM with an "updates since your last turn" summary. A loop guard limits wake-ups.
5. **The PM decides.** It follows up with the agent, merges nothing on its own unless that project's policy allows it, and escalates to the orchestrator or the inbox when unsure.
6. **The orchestrator wakes only for what matters.** PM messages can be marked informational so routine updates don't wake it.

Notices are structured data all the way to the UI, which renders them as cards; they're never encoded as text to be parsed back.

### 8.3 Internal MCP tools

One tool registry, exposed through MCP and also called directly by the UI's API handlers, so the agents and the UI can never drift apart. Each tool is one module:

```ts
defineTool({
  name: "start_session",
  description: "...",
  roles: ["pm"],
  input: z.object({ /* ... */ }),
  scope: "project",                 // resolved from the caller's token
  handler: async (input, ctx) => { /* calls the same service the UI uses */ },
});
```

- **Scoping.** Each session gets an MCP bearer token encoding its role, project and session. The token is revoked when the session ends. Tools outside the caller's role aren't listed at all.
- **Tool loading.** A small set of core tools is always loaded; the rest are deferred behind tool search so large tool sets don't fill the context window.
- **Situational-awareness tools** (§8.4) are core tools for the orchestrator and PMs and are always loaded.
- **Initial tool set** (to be extended):
  - **Orchestrator:** `list_projects`, `create_project`, `update_project`, `message_pm`, `ask_pm`, `get_overview`, `list_inbox`.
  - **PM:**
    - Sessions: `list_sessions`, `start_session`, `message_session`, `stop_session`.
    - Issues: `list_issues`, `get_issue`, `triage_issue` (labels, comment, accept/decline), `create_issue`.
    - PRs and escalation: `get_pr_status`, `ask_user`, `message_orchestrator`.
    - Automations and notes: `list_automations`, `run_automation`, `read_project_notes`, `update_project_notes`.
  - **Agent:**
    - People: `ask_user`, `message_pm`, `report_progress`.
    - Sharing and evidence: `share_to_chat` (file or screenshot), `attach_evidence` (to an issue or PR).
    - Results: `create_pull_request`, `suggest_followups`, `finish` (with a structured result).
    - Browser tools (§12.2).
  - **All roles:** `generate_image` (§12.5).

### 8.4 Situational awareness and conflict handling

The orchestrator must always know what's happening across all projects, and each PM must know everything running in its project, including scheduled work that hasn't started yet. Starting work must never silently duplicate work already running.

- **Every unit of work is described in data.** Each session and automation run records:
  - `startedBy` (user, orchestrator, pm or automation, with the id)
  - `purpose` (one line)
  - `workKey`, a stable identifier of *what* the work is: for example `automation:security-audit`, `issue:142` or `pr:57`, or one derived from the request
  - `scope` (project, paths or area)
  - status, progress (the last `report_progress` call) and timestamps
- **Status digest injected on every wake.** Each time the orchestrator or a PM wakes, CodeDen adds a compact, up-to-date digest to its context, so it knows the current state without spending a tool call:
  - **PM digest:** running and queued sessions (`workKey`, purpose, status, progress, age); the next scheduled runs of the project's automations; open inbox items; recent finishes and failures.
  - **Orchestrator digest:** the same, rolled up per project.
- **Awareness tools** (always loaded):
  - **Orchestrator:** `get_overview` (every project: running work, upcoming scheduled runs, inbox counts, recent outcomes).
  - **PM:** `get_project_status`, `list_sessions` (filter by status, `workKey`, startedBy), `list_scheduled_runs` (upcoming runs per automation), `skip_next_run`, `pause_automation`, `resume_automation`, `cancel_queued_run`, `stop_session`.
- **Conflict detection is built into starting work.** `start_session`, `run_automation` and scheduled triggers first check for running or queued work with the same `workKey`, or an overlapping `scope` for the same kind of work, in that project.
  - **When there's a match,** the call returns `conflict` with the existing work's details instead of starting anything.
  - **The caller then picks one of:** `wait` (queue behind it), `skip`, `join` (send the request to the existing session as a follow-up), or `force` (start anyway, with a reason that's recorded).
  - **Example:** you ask the orchestrator for a security audit. It asks that project's PM, which sees `automation:security-audit` already running and replies with its progress and the options. Nothing is duplicated.
- **Scheduled triggers when the previous run is still going.** The default guard is `skip-if-running`. Each automation can instead choose `queue` or `run-anyway`.
  - **Skipped runs** are recorded as `automation_run` rows with status `skipped` and the reason, and a notice wakes the PM, which may choose to take over or adjust the schedule.
  - **The PM can act ahead of time,** for example skipping the next cron run because an audit started by hand will still be going.
- **Cross-project view.** The orchestrator's overview flags work running in several projects at once, including conflicts it can't resolve itself; those go to your inbox.
- **UI:** each project shows a **Now / Next** strip (running work and upcoming scheduled runs). A conflict surfaces as a card with the same `wait`, `skip`, `join` and `force` actions.

## 9. Git and GitHub

- **Worktrees.** Each agent session gets a worktree under `~/.codeden/wt/` on a new branch. Branch names follow the project's convention, with `codeden/<slug>` as the fallback. Sessions can also run in the repo root or an existing worktree when chosen explicitly.
- **Worktree cleanup.** Archiving a session removes its worktree; an hourly sweep removes worktrees of sessions inactive for a configurable number of days (default 7), unless the session's pull request is still open. Uncommitted changes always keep a worktree unless the user forces removal. The branch and checkpoints stay, and the next message to the session recreates the worktree at the same path from its branch, running setup again. Cleanup goes through the runner's `workspace.remove` / `workspace.prepare` commands, so a remote runner cleans up its own storage the same way.
- **Setup scripts.** `.codeden/project.json` can define commands such as `pnpm install`, which run when a worktree is created, plus a dev-server command and the default provider.
- **Turn checkpoints.** At the end of each turn the runner snapshots the worktree into a hidden ref (`refs/codeden/checkpoints/<session>/<n>`). It uses a temporary index (`write-tree` → `commit-tree` → `update-ref`), so the user's branch and index are never touched. This gives exact per-turn diffs and file-level undo; full rollback is offered only when the provider can also roll back its conversation.
- **GitHub API.** Octokit on the server, authenticated with the token from `gh auth token` (read at runtime, not stored). Agents use `gh` inside their worktrees.
- **Sync.** Issues, PRs, checks and reviews are polled with conditional requests (ETags) and batched GraphQL. A local app can't receive webhooks; webhook support arrives with remote runners.
- **Traceability.** Every session records its issue, branch, PR and commits. PR bodies link the issue (`Fixes #N`) and the CodeDen session.
- **Evidence.** Screenshots and test artifacts are committed to a dedicated orphan branch (`codeden/evidence`) and linked from PR and issue comments, so GitHub renders them inline. Test output and summaries are posted as comments.
- **Local-only projects** (no GitHub remote) get sessions, worktrees, checkpoints, diffs and automations, but no issue, PR or evidence flow.

## 10. Automations

- **What an automation is:** a **trigger**, an **action**, a **target** and **guards**.
  - **Triggers:** `cron` (croner, in the project's timezone), `event` (`session.finished`, `pr.opened`, `pr.merged`, `pr.checks_failed`, `issue.opened`, `issue.labeled`, …), or `manual`.
  - **Actions:** start an agent session with a prompt template, message the PM, or run triage.
  - **Guards:** an overlap policy (`skip-if-running`, the default, or `queue` or `run-anyway`, using the `workKey` conflict check from §8.4), a concurrency cap, quiet hours, a maximum per day, and catching up missed runs after downtime.
- **Templates** are Markdown files with YAML frontmatter (trigger, provider, autonomy, prompt), so they're readable and editable. Built-in templates:
  - security audit
  - refactor sweep
  - dependency updates
  - UI review
  - test coverage gaps
  - issue triage
  - stale PR follow-up
- **Where they live.** Global templates live in `~/.codeden/automations/`. Project automations live in the repo's `.codeden/automations/` (commit them or not) or in the database.
- **Control.** Everything is toggleable globally, per project and per automation. **All automations are off by default**: a new project offers a starter set to enable.
- **Issue triage.** The PM reads new issues and classifies them as ready, needs info, unsafe, out of scope or duplicate. It applies labels and comments according to project policy, and either starts a session or puts a decision in your inbox when unsure ("Should I take this on?").
- **Visibility.** Every automation run is a normal session (or PM turn) with a full transcript, so background work stays visible.

### 10.1 Project autonomy modes and dark-factory mode

Each project has an **autonomy mode**, a ladder you can climb one step at a time:

| Mode | Who finds work | Who merges | You |
|---|---|---|---|
| **Manual** | You | You | Drive every session |
| **Assisted** (default) | You, the PM (triage) and automations | You | Review PRs and answer the inbox |
| **Autopilot** | The PM, from issues, automations and the vision | CodeDen, automatically, when every merge check passes; anything else comes to you | Check the daily digest and handle exceptions |
| **Dark factory** | The PM continuously, from the vision | CodeDen, automatically | Set the vision and the limits, then step away |

**Vision.** Autopilot and dark-factory modes require a project vision in `.codeden/VISION.md`, edited in the UI. It covers:
- goals, target users and principles
- what is out of scope
- quality bar
- **protected areas** (paths or topics that always need a human: auth, payments, data migrations, infrastructure, licensing)

**The factory loop.** The PM runs it continuously, paced by a budget:
1. **Discover.** Improvement-finder automations (feature ideas grounded in the vision, UX review, performance, tech debt, test gaps, security), incoming issues and failed checks become candidate work items, each checked against the vision.
2. **Prioritise and plan.** The PM scores candidates against the vision and creates a GitHub issue for each accepted item, with a work key and acceptance criteria. That keeps the factory's backlog visible and editable by you.
3. **Build.** Agent sessions implement the issues in worktrees, with duplicate checks (§8.4) applied.
4. **Verify (merge checks).** All checks must pass before an automatic merge:
   - CI green, and the tests the change needs exist and pass
   - a **review by a separate agent session**, ideally on a different provider from the one that wrote the code, against the acceptance criteria and the vision
   - security and dependency scans clean
   - UI changes: browser screenshots as evidence, plus an end-to-end check
   - the change is under a size limit and touches no protected area
5. **Merge.** Squash-merge, then link the result back to the issue.
6. **Watch.** After merging, CI on main is watched. A regression triggers an **automatic revert PR**, which goes through the same merge checks, plus a pause of the factory loop and an inbox item.
7. **Report.** A daily digest lists what shipped, what was rejected and why, spend, and anything waiting on you.

**Limits** (required, enforced by the server, not left to agent judgement):
- maximum concurrent sessions, maximum PRs merged per day
- a token or cost budget per day
- **Pause on repeated failures:** the loop pauses after N failed merge checks or reverts in a row.
- **Protected areas** always escalate to you.
- **No deploys or releases** unless they're explicitly enabled as a separate automation.
- **A kill switch** on the project and globally: one click stops the loop and all its sessions.

**Visibility.** Factory work is ordinary sessions, issues and PRs, so it all stays traceable. The project shows a **factory panel**: loop state, backlog, items in progress, merge-check results, spend against budget, and recent merges and reverts.

**Delivery.** Autopilot and dark-factory modes ship in v1 marked **experimental** (milestone M3b). Assisted remains the default for new projects.

## 11. Human in the loop

### 11.1 Inbox

The inbox is one view, also available as an MCP tool. It collects:

- questions from agents
- approval requests
- PRs ready for review
- failed or stuck runs
- triage decisions
- automation results flagged for attention

Each item links to its session, issue and PR, and can be answered in place. The sidebar shows a count, and items also raise toasts and opt-in browser notifications.

### 11.2 Autonomy levels

Each level maps onto each provider's **native** enforcement:

- **Supervised:** every edit and command asks.
- **Auto, risky actions ask** (default):
  - Edits and normal commands inside the worktree run freely.
  - Risky actions go to the inbox: writes outside the worktree, force pushes, deleting branches, global installs, network access to unlisted hosts, and secrets access.
  - **Claude:** `acceptEdits` plus a `canUseTool` policy classifier.
  - **Codex:** workspace-write sandbox plus on-request approvals.
- **Full autonomy:** no approvals inside the worktree.

The orchestrator and PMs have no write access to project code; they act only through CodeDen tools.

### 11.3 Voice

Both sides sit behind provider interfaces, so engines can be swapped:

- **Speech to text** (composer dictation, push-to-talk with a keyboard shortcut):
  - **Default:** the browser speech API.
  - **Optional:** a cloud engine (ElevenLabs or OpenAI).
  - **Later:** local Whisper, which is needed for Electron and Firefox.
- **Text to speech** (reads an agent's final message when its turn completes):
  - **Default:** the browser's `speechSynthesis` (free).
  - **Optional:** ElevenLabs.
  - **What gets read:** code blocks and markdown are stripped, and long messages are compressed to one or two sentences by the utility model (§7.4) first.
  - **Controls:** global and per-session toggles, quiet hours, and "only when the tab isn't focused".

## 12. Workbench

### 12.1 Terminal

node-pty sessions owned by the runner, so they survive server restarts, with bounded scrollback history. The UI uses xterm.js. Each session has a terminal in its worktree, and you can open more.

### 12.2 Browser

- **Engine.** The runner launches Chromium through playwright-core: the installed Edge or Chrome first, with a download on first use only with consent. You see it in a browser panel through a CDP screencast and can take over at any time.
- **Agent tools.** Agents drive the **same browser** you see:
  - navigate
  - accessibility snapshot
  - click and type
  - screenshot
  - console and network logs
- **Screenshots.** They can be posted to the chat with `share_to_chat` or attached as PR evidence.
- **Isolation.** One browser context per session.
- **Dev servers.** CodeDen discovers running dev servers so agents and you can open them in one click.
- **Spike first:** attach Microsoft's Playwright MCP over CDP rather than writing the tools ourselves. If several sessions can't share it cleanly, fall back to about ten tools of our own on playwright-core.
- **The key seam:** agents talk to the browser only through CDP. Electron's native browser view also speaks CDP, so only the panel's display changes later.

### 12.3 Files and diffs

A file tree for the worktree, a file viewer and editor (CodeMirror 6), turn and session diffs from checkpoints, and a PR view.

### 12.4 Agent configuration

First-class screens for each provider's own files:

- **Memory:**
  - Claude: global `~/.claude/CLAUDE.md`, project `CLAUDE.md` and `CLAUDE.local.md`, `.claude/rules/`, and the auto-memory folder.
  - Codex: `~/.codex/AGENTS.md` and repo `AGENTS.md` files, including nested ones.
- **Skills:** each provider's user and project skill folders, with create, edit and enable controls.
- **Subagents:** `.claude/agents/` and `~/.claude/agents/`, plus Codex equivalents where they exist.
- **MCP servers:** `.mcp.json`, Claude user config and `~/.codex/config.toml`. Add, edit, test the connection, and enable per provider.
- **What's loaded:** for any session, a view of which memory files, skills and MCP servers are in its context.

Edits are written to the native files in place (Principle 2), with a diff preview and a backup before overwriting.

### 12.5 Image generation

Any agent can generate images through the `generate_image` MCP tool, whatever its own provider can do. A Claude agent building a landing page can ask for a hero image, for example.

- **Tool input:**
  - `prompt`
  - `aspectRatio` or `size`, `count`
  - optional `referenceImages`, for edits and variations
  - `outputPath` inside the worktree
- **Tool output:** the file paths. Images are also saved as artifacts and shown inline in the chat.
- **Engines** sit behind an `ImageEngine` interface:
  - **Codex** uses the user's existing Codex login: CodeDen runs a short, tool-restricted Codex turn that generates the image and saves it to the requested path. It's the default when setup finds Codex logged in.
  - **Gemini** image models ("Nano Banana" and successors) take a Google AI API key.
  - **OpenAI Images** takes an OpenAI API key.
  - **More later** (fal, Replicate, local models) through the same interface.
- **Settings:**
  - the active engine, with a "test" button
  - default size and quality
  - per-project overrides
  - a daily cap
  - API keys are stored in the OS keychain
- **Unavailable engine.** If no engine is available, the tool is hidden from agents rather than failing at call time.

### 12.6 Usage and cost reports

Detailed, trustworthy reports on spend and usage across every provider, project and kind of work.

- **Ledger.** Every turn records a **usage delta**. It's computed from the provider's own figures: Claude reports cumulative session totals, so CodeDen stores the per-turn difference. Each delta holds:
  - input, output, cache-read and cache-write tokens
  - reasoning tokens where reported
  - cost in USD as reported by the provider
  - session, project, provider, model, role (orchestrator, PM or agent), `startedBy`, automation id and timestamp
- **Cost sources are labelled honestly.** Each figure is marked `reported` (the provider returned a USD cost) or `estimated` (tokens multiplied by a bundled, user-editable price table per model).
  - **API-key users** see actual spend.
  - **Subscription users** (a claude.ai or ChatGPT login) see an **"API-equivalent cost"**, clearly labelled as such, so they know what the same work would cost on API credits.
- **Rate limits.** CodeDen records each provider's limit status as it reports it: Claude's 5-hour and weekly windows, and Codex rate-limit snapshots from `app-server`. It shows how much of each window is used and when it resets, and can warn before a limit is reached.
- **Reports screen:**
  - a time range (today, 7 or 30 days, custom) and a total
  - stacked charts by day for provider, model, project and role
  - top sessions by cost
  - an automation and factory spend breakdown
  - cache hit rate
  - average cost per merged PR and per session
  - drill-down from any bar to the sessions behind it
  - CSV export
- **In context.** Cost and tokens appear on each session header and turn footer, a per-project spend card sits on project home, and the dark-factory budget meter (§10.1) reads from the same ledger.
- **Budgets and alerts.** Optional daily or monthly spend alerts globally and per project, delivered as inbox items and notifications. Factory limits enforce the same figures.

## 13. UI

- **Left sidebar.** The orchestrator chat is pinned at the top. Below it, the **Inbox** with a count, then projects. Each project expands to show its PM and its sessions, with status dots (running, waiting on you, done, failed) and linked issue and PR badges. Automations sit under each project.
- **Centre.** The chat transcript of the selected thread, virtualised for long histories:
  - streaming markdown (Streamdown) with Shiki code highlighting
  - tool calls grouped into collapsible work blocks with live command output
  - plans and todos as cards, subagent cards, approval and question cards answerable inline
  - typed notice cards
- **Composer:**
  - text, pasted images and file attachments, `@` file mentions, `/` commands and skills
  - provider, model and effort pickers, plus the autonomy level
  - queue or steer while a turn runs
  - the voice button
  - **follow-up chips** after a turn completes (§7.5)
- **Right panel** (tabs): diff, files, browser, terminal, issue/PR, session details. A bottom terminal drawer is optional.
- **Global:** command palette, keyboard shortcuts, settings, light and dark themes.
- **Platform bridge.** Notifications, opening links, folder picking, global shortcuts, clipboard images and badge counts go through one `PlatformBridge` interface in the UI. It has a web implementation and a desktop one (§17), chosen by detecting the desktop app's `window.codedenDesktop` bridge; features are read from `capabilities`, never "am I in Electron?". Browsers can't return real folder paths, so projects are added through a **server-side folder picker**, which also suits remote use; the desktop app (`capabilities.folderPicker`) uses the system folder picker, with the server-side one as a fallback.

## 14. First-run setup and inheriting credentials

The goal is to get from `npx codeden` to your first session in under a minute, without typing a single credential if your machine is already set up.

1. **Start.** `npx codeden` checks the Node version, creates `~/.codeden/`, generates the install token, starts the server and runner, and opens the browser on an already-authenticated URL.
2. **Detect.** One checklist screen with live ticks. All checks run in parallel and nothing is asked when a check passes:
   - **Claude Code:** `claude --version`, then `claude auth status`. This returns JSON with `loggedIn`, `authMethod` and `loginExpiresAt`. Logged in means ready; the Agent SDK uses the installed binary and its login.
   - **Claude Code support:** when `claude` is installed, a row for the Claude Agent SDK. It installs into `~/.codeden/deps/` when the user continues, with live progress; a failure shows npm's reason and a **Retry**. Sessions that start before it is installed install it themselves, and `codeden doctor --install` does it from a terminal.
   - **Codex:** `codex --version`, then `codex login status`. Logged in also enables **image generation through Codex** as the default engine (§12.5).
   - **GitHub:** `gh auth status`. Logged in means ready, and the token is read at runtime with `gh auth token`, never stored.
   - **git identity:** `git config user.name` and `user.email`.
   - **Browser:** an installed Edge or Chrome.
3. **Fix only what's missing.** Each failed check has one action:
   - The install command for the tool.
   - Or a **Sign in** button that runs the tool's own login (`claude auth login`, `codex login`, `gh auth login`) in an embedded terminal, so the provider's normal browser login flow handles it.
   - API keys are only an advanced alternative, never the default ask.

   At least one agent provider is required; GitHub is recommended but optional (local-only projects work without it).
4. **Optional extras,** skippable: voice (test the mic, choose read-aloud on or off, optional ElevenLabs key into the keychain) and notifications permission.
5. **First project.** Pick a local folder or clone a GitHub repo. CodeDen detects the package manager and suggests a worktree setup script.
6. **Re-check on every launch,** silently. Warnings appear only when something changes, such as an expiring Claude login (`loginExpiresAt`), a logged-out CLI or a version too old for the adapter.

## 15. Security

- **Network.** The server and runner listen on **127.0.0.1 only**. A per-install random token is required on every HTTP, WebSocket and MCP request.
- **Request checks.** `Origin` and `Host` headers are checked, which blocks other websites and DNS rebinding from reaching the local API.
- **The UI token.** It's delivered once through the launch URL and then held in an HttpOnly, SameSite=Strict cookie.
- **MCP tokens** are per session and role-scoped, and revoked when the session ends.
- **Agent environments.** Agent processes inherit the user's environment minus CodeDen's own secrets. Tokens are never logged or written into transcripts.
- **Approvals.** Risky-action approvals follow §11.2. The orchestrator and PMs can't write project code.
- **Remote access** (phone, LAN) isn't in v1. When added, it requires explicit opt-in and a password or pairing.

## 16. Distribution and operations

- **Install.** `npx codeden` (or `npm i -g codeden`), or the desktop app's installer from GitHub Releases (§17). The CLI subcommands:
  - `codeden` (start and open)
  - `codeden doctor` (diagnostics, including installed versions and which one starts)
  - `codeden update` (install the latest version and switch to it), `codeden update --rollback`
  - `codeden stop`
  - `codeden --port`, `--home`
- **Updates: one click, side by side.**
  - **Check.** On server start and every 6 hours the server asks the npm registry for `codeden`'s `latest` dist-tag (only the package name is sent). The status is served at `GET /api/updates` and pushed live as an ephemeral `update` WebSocket message (like runner status, not in the event log). Setting `updates.mode`: `off`, `notify` (default) or `auto` (download in the background; it starts on the next launch, or now with "Restart now").
  - **Install.** "Update now" runs `npm install codeden@<version> --omit=dev --no-audit --no-fund` into a staging folder under `<home>/app`, checks the result (package version, entry files, and the installed CLI answering `--version`), then renames it to `<home>/app/<version>/`. A lock file serialises installs (server and `codeden update`); progress lines stream to the UI. The running version's files are never touched (Windows locks loaded native modules). `<home>/app/current.json` (`AppPointer`: version, previous) then names the new version; older versions are pruned to the pinned one and its previous.
  - **Launcher.** Every copy of the CLI (npx cache, global install, side-by-side version) runs a small launcher first: when `current.json` names a valid installed version newer than itself, that version's `dist/cli.js` is loaded with `import()` in the same process, so arguments, environment, signals and exit codes are unchanged and no extra process is left. A missing or broken pinned version falls back to the launched copy with a warning (stderr, About, `doctor`). A newer global install wins over an older pin. Builds from a source checkout (the package root still has `src/`) never switch; the UI says to pull and rebuild.
  - **Version at runtime.** The published entries set the version from their own `package.json` before loading the bundle, so the package version is the single source of truth (`SOURCE_VERSION` in contracts is kept in sync for the workspace).
  - **Restart.** After the install the server announces `restarting` and calls the CLI's restart hook: the CLI closes the server (the runner keeps running), starts the new version's CLI as a child in the same terminal with the original arguments plus the port in use and `--no-open`, and stays as a thin parent that passes on signals and the exit code. The new server finds the old runner, sees the version mismatch and drains it (§4.2), so interrupted turns resume through the existing path. The browser polls `/api/health`, reloads when the new version answers (same port and install token, so the cookie still works) and confirms "CodeDen updated to X". If the new version exits before answering, the CLI restores `current.json`, records the failure (`<home>/app/last-update.json`) and starts the old version again; the UI shows the error with Retry. A server not started by the CLI (development) cannot restart itself and shows "Update installed, restart CodeDen to finish" with the command.
  - **Rollback.** About and `codeden update --rollback` point `current.json` back at the previous version (or clear it to run the launched copy) and restart.
  - **Tests.** `CODEDEN_UPDATE_REGISTRY` and `CODEDEN_RELEASE_NOTES_URL` point the check, the install and the release notes at a local fake registry; they exist for tests only.
  - **The desktop app** (§17) uses the same setting, the same 6-hour schedule and the same banner, but not npm: the server's update service runs in desktop mode (`InstallSource` `desktop`, `DesktopUpdateService`) and drives the app's updater (electron-updater, GitHub Releases) over IPC. "Update now" downloads with progress, then the app stops the runner gracefully (as `codeden stop`), installs and restarts; sessions resume through the usual path. `auto` downloads in the background and installs on quit. Side-by-side npm versions and rollback don't apply. `CODEDEN_DESKTOP_UPDATE_URL` (tests only) points the app at a local feed.
- **Telemetry.** None. CodeDen sends nothing anywhere; the only outbound requests are the optional npm registry version lookup and, when you open "What's new", the release notes from GitHub.
- **Native dependencies.** Kept to `node-pty` and `@napi-rs/keyring`, both with prebuilt binaries. Installing through `npx` on Windows, macOS and Linux is checked in CI.

## 17. The desktop app (Electron)

`apps/desktop` is a thin Electron shell that starts the same server and loads the same UI. The seams that keep it thin stay mandatory:

1. The server is started through `startServer(...)` and never imports Electron.
2. The UI talks to the server only over HTTP and WebSocket, with a configurable base URL and token.
3. Platform features go through `PlatformBridge` (§13).
4. Agents use the browser only through CDP.
5. Secrets are already in the OS keychain.
6. Native dependencies are kept minimal and Node-API (they load in Electron without a rebuild).

**Processes.** The main process (TypeScript, bundled with tsdown) owns the window, tray and updater. It uses the same home as `npx codeden` (`~/.codeden`): if a live server for that home exists (lock file, live pid, `/api/health`) it attaches to it; otherwise it forks `dist/server.js`, the same server the CLI ships, on its own binary as Node.js (`ELECTRON_RUN_AS_NODE`, the helper binary on macOS), on port 4317 or any free port. No system Node.js or npm is needed. Every place that starts CodeDen's own scripts with `process.execPath` (the runner, npm, Playwright's CLI) adds `ELECTRON_RUN_AS_NODE` explicitly; the server and runner remove it from their own environment so shells and agents never inherit it, and npm-style shims of the user's tools run on the user's `node` when there is one. The runner stays detached. Server and main talk over Node IPC with `DesktopServerMessage` / `DesktopHostMessage` (contracts). Quitting closes the server and leaves the runner running; a server stopped from outside (`codeden stop`) quits the app.

**Window and bridge.** One window on the server's UI, loaded through the token launch URL (the cookie bootstrap as in the browser). `contextIsolation`, `sandbox`, no `nodeIntegration`, navigation locked to the server origin (other links open in the system browser), permissions limited to notifications, the microphone (audio only), the clipboard and fullscreen for the server's pages, no debugging port. The preload exposes only `window.codedenDesktop` (`CodedenDesktopApi`: info, folder picker, notifications with click-through, open external, badge, navigation), validated in the main process. The Chromium profile and window state live in `<home>/desktop`, so a separate `--home` is a fully separate app; one instance runs per home.

**App integration.** A tray (menu bar on macOS) with running and waiting counts from `GET /api/activity` (counts by session status, never by provider), the app icon badge, native notifications, the system folder picker, `codeden://` links (`session/<id>`, `project/<id>`, `inbox`, `settings/<section>`), keep-awake (`powerSaveBlocker`) while an agent runs, open at login, close to tray, and an application menu with the standard roles. Its settings are a `desktop` section in `Settings` (launch at login, close to tray, keep awake), read by the app by polling the server.

**Claude Code support** is installed on demand without npm (`CODEDEN_DEPS_INSTALLER=registry`): the pinned SDK tarball is fetched from the registry, checked against the manifest's sha512 integrity and unpacked into `<home>/deps`. It is never bundled.

**Updates** (see §16): electron-updater against GitHub Releases, driven by the server's update policy, so the existing banner works unchanged. Installing stops the runner first (it may run from the install folder, and Windows locks files in use). When attached to a server started by `codeden`, the app follows the update mode on its own (tray and a notification). macOS updates need a Developer ID signature; unsigned builds say so instead of offering updates.

**Packaging and release.** electron-builder from a staged app (`dist/` plus the runtime dependencies installed with npm, no asar): NSIS per-user (no admin, Start menu and desktop shortcuts, uninstaller), dmg + zip for arm64 and x64 (the zip feeds the updater), AppImage + deb. Signing is optional through `CSC_LINK`/`CSC_KEY_PASSWORD` and notarization through `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`; without them builds are unsigned (SmartScreen and Gatekeeper warn). The release workflow builds all three on a version tag after the npm publish and attaches the installers and `latest*.yml` metadata to the same GitHub Release. The desktop version always equals the CLI version.

**Phase 2.** The browser panel stays the CDP screencast (§12.2); an embedded Electron browser view behind the same panel is a later step. Browser speech recognition doesn't work inside Electron, so dictation there needs a local or cloud speech-to-text engine.

## 18. Testing

- **Unit tests** (Vitest): the event reducer, projections, the tool registry, the autonomy policy classifier, the scheduler and the runner protocol.
- **Provider tests** run against the **Replay** provider, with sessions recorded from the real CLIs. A small set of live smoke tests runs on demand.
- **End-to-end** (Playwright): first-run setup (with CLIs faked), starting a session, approvals, the inbox, voice controls (mocked) and the browser panel, all driven by the **Fake** provider.
- **CI:** Windows, macOS and Linux, including an install check of the packed npm tarball.

## 19. Milestones

| # | Milestone | Contents |
|---|---|---|
| M0 | Foundations | Monorepo, server, runner, web skeleton, runner protocol and lifecycle, DB and migrations, security token, first-run setup and detection, CI |
| M1 | Daily driver (private use starts here) | Projects (GitHub and local), sessions on Claude and Codex, worktrees and setup scripts, transcript with tool calls and subagent threads, approvals and autonomy levels, checkpoints and diffs, terminal, browser with agent tools and screenshot sharing, memory/skills/subagents/MCP editors, voice, notifications, image generation tool, utility model and follow-up prompts |
| M2 | Orchestration | Usage and cost reports (§12.6), orchestrator and PMs, the MCP tool registry by role, typed notices and wake-ups, inbox, GitHub issue and PR flow, evidence branch, PR and check sync |
| M3 | Automations | Scheduler, event triggers, guards, the template library, issue triage, per-project toggles, custom automations |
| M3b | Autonomy modes (experimental) | Project autonomy modes, the vision editor, the factory loop, merge checks with cross-provider review, automatic merge and revert, limits and kill switch, factory panel and daily digest (§10.1) |
| v1.0 | Public launch | Polish, docs, `npx codeden` release |
| Desktop | Desktop app | The Electron app (§17): installers, tray, notifications, deep links, automatic updates |
| Later | | OpenCode, ACP adapter, embedded browser view in the desktop app, remote runners (Upstash Box, SSH/VPS, Docker), webhooks, GitLab and other forges, remote/mobile access |

## 20. Spikes before M1 (de-risk first)

1. **Runner lifecycle on Windows.** A detached process that survives the server exiting, process-tree kill, the lock file, and draining on upgrade.
2. **Claude Agent SDK** with `pathToClaudeCodeExecutable`: streaming input, `canUseTool`, `resume`, subagent `parent_tool_use_id` events, and an injected MCP server.
3. **Codex `app-server`:** generating TS types, the turn and approval flow, MCP injection, and sandbox behaviour on Windows.
4. **Browser:** Playwright MCP over CDP with several sessions in one Chromium, versus our own tools; and screencast latency in the panel.
5. **MCP Streamable HTTP on Hono,** behind the runner proxy, with token scoping.
6. **Packaging:** installing `node-pty` and `@napi-rs/keyring` through `npx` from a packed tarball on all three operating systems.
7. **Image generation through Codex:** the most reliable way to get an image file back from a headless Codex turn under a ChatGPT login (`app-server` or `exec`), plus latency and failure modes. Also check the Gemini and OpenAI image APIs' current models and parameters.

## 21. Risks

| Risk | Mitigation |
|---|---|
| Provider protocols change (Codex `app-server`, Agent SDK) | Pin tested versions; generate Codex types from the installed CLI; the adapter contract tests run on Replay fixtures; `doctor` reports unsupported versions |
| Terms for using subscription logins inside third-party harnesses | CodeDen never implements its own login; it runs the user's own CLI with its own login. Track Anthropic and OpenAI terms; API keys are a supported alternative |
| Adapters grow large and fragile | Small modules per concern (session, events, approvals, subagents); honest capability flags; Replay tests per adapter |
| Windows edge cases (ConPTY, path length, process trees, Codex sandbox) | Windows tested first; short worktree paths; process-tree kill; spike 1 |
| Scope (the full vision for v1) | Strict milestone order; private use from M1; the "Later" list stays out of v1 |
| Agents acting unsafely on autopilot | Default autonomy asks for risky actions; automations off by default; PMs can't write code; everything traceable |
