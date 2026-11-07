# Changelog

All notable changes to CodeDen are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [0.1.0] - first public release

The first public release of CodeDen, a local-first harness for coding agents. Install with `npx codeden`.

### Daily driver

- **Claude Code** through the Claude Agent SDK (using your installed `claude` and its login) and **Codex** through `codex app-server`, behind one normalized event model.
- Agent sessions in their own **git worktrees and branches**, with `.codeden/project.json` setup commands.
- A transcript with grouped tool calls, plans and todos, subagent threads, and approval and question cards answerable inline.
- **Autonomy levels**: Supervised, Auto with risky actions asking (the default) and Full autonomy, mapped onto each provider's native enforcement.
- **Turn checkpoints** in hidden git refs: per-turn and whole-session diffs and file restore.
- **Workbench**: file tree and editor, runner-owned terminals that survive server restarts, and a browser the agents drive and you can take over.
- **Agent configuration** editors for memory files, skills, subagents and MCP servers, written to each provider's native files with a diff preview and a backup.
- **Image generation** for every agent through one `generate_image` tool (Codex, Gemini, OpenAI Images).
- **Voice**: dictation with push-to-talk and read-aloud of final messages.
- **Follow-up prompt chips** when a turn completes.
- First-run setup that detects and reuses existing Claude Code, Codex, GitHub and git setups, and `codeden doctor`.

### Orchestration

- An **orchestrator** across projects and a read-only **project manager** per project, with status digests on every wake and typed notices.
- **Work keys and conflict detection** with wait, skip, join and force.
- One **inbox** for questions, approvals, PRs ready for review, failed runs, triage decisions and conflicts.
- **GitHub** issue, PR, check and review sync through `gh`, PRs that link their issue and session, and screenshots and test output on the `codeden/evidence` branch.
- **Usage and cost reports**: a per-turn ledger, reported versus estimated costs, API-equivalent cost for subscriptions, rate-limit windows, budgets and alerts, and CSV export.

### Automations

- A scheduler with cron, event and manual triggers, guards (overlap policy, concurrency, quiet hours, daily caps, catch-up), runs history and per-project switches. All off by default.
- Built-in templates: security audit, refactor sweep, dependency updates, UI review, test coverage gaps, issue triage and stale PR follow-up. Custom automations as Markdown files.
- Issue triage by the PM, with a "Should I take this on?" inbox decision.

### Autonomy modes (experimental)

- Project modes Manual, Assisted (the default), **Autopilot** and **Dark factory**.
- A `.codeden/VISION.md` editor with protected areas, the factory loop, merge checks with an independent cross-provider review, automatic squash merge and automatic revert, server-enforced limits, a per-project and global kill switch, the factory panel and a daily digest.
