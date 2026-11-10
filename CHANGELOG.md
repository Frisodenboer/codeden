# Changelog

All notable changes to CodeDen are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- **Refresh models.** A refresh button at the bottom of the model picker's provider rail asks the shown provider for its models again (on Favourites, every provider), for when a new model is out and the list hasn't caught up yet.
- **Claude Fable 5.2 is priced** in usage reports ($8 / $40 per million input / output tokens), and so is the `fable` alias.

### Changed

- **The browser panel is a real browser surface.** The page now fills the panel edge to edge and is laid out at the panel's own size, instead of a fixed 1280×800 page shrunk into a small card. It re-flows as you resize the panel, and it's sharp on HiDPI screens (rendered at your screen's pixel ratio, up to 2×). Pick a fixed device size under **⋯ › Viewport** if you want one; **Fit to panel** is the default.
- **No more "Take over".** Clicks, typing and scrolling always go straight to the page, even while an agent is using it. An **Agent is acting** chip in the toolbar shows when an agent drives the browser.
- **Several viewers share one page size.** With the panel open on your desktop and your phone, the one you used or focused last decides the size, and the others fit the page inside their panel. Opening the panel on another device no longer changes the page under you.
- **Agent screenshots use the current page size,** in CSS pixels, so a HiDPI screen doesn't double the image an agent gets back.

### Fixed

- **The macOS desktop app no longer opens as "damaged".** Downloaded builds were reported as "CodeDen is damaged and can't be opened" on Apple silicon Macs, with no way past it, because the app wasn't signed at all. Builds without a Developer ID are now signed ad hoc, so macOS only says it can't verify the developer, which you allow once: open CodeDen, then choose **Open Anyway** under **System Settings › Privacy & Security**. Every release now checks the downloaded `.dmg` and `.zip` on macOS before it ships. If an older version still says "damaged", see [Unsigned builds](docs/desktop.md#unsigned-builds) for the one-line fix. These builds still can't update themselves; download new versions from GitHub Releases.
- **New Claude models show up without restarting everything.** A model release changes Claude Code's model list even when nothing on your machine changes, and CodeDen kept the list it read when its background runner started; the runner keeps going when you restart CodeDen, so the picker could show an old Fable for days. CodeDen now asks again when the app reconnects (if the list is more than 10 minutes old), whenever a session starts, and when you refresh. It also finds `claude` and `codex` on your PATH each time instead of reusing the location from when the runner started, so moving to another install is picked up too.
- **Sessions on a full model id get their effort control back.** A session on, say, `claude-opus-5-5` (what Opus runs today) was shown as "isn't in the provider's list any more" with no effort levels. The picker now shows it as **Opus 5.5** with Opus's effort levels, and an id no entry covers still gets the default model's levels.
- **A second viewer of a still page now sees it straight away.** It used to wait for the page to change before its first frame arrived.
- **Scrolling in the browser panel is natural.** It now moves the page at the speed of your gesture, also for mice that scroll by lines.

## [0.4.4] - 2026-11-09

### Added

- **Read-aloud speaks a TL;DR.** **Settings › Voice › What to read** chooses between **TL;DR** (the default: one or two sentences saying what was done and whether anything needs you, about 15 seconds at most) and **Full message** (the whole final message without code or Markdown, up to 5,000 characters). This replaces the **Read-aloud summaries** switch under Utility model.
- **Read-aloud says who's speaking.** Each message starts with who it's from, such as "Orchestrator", "codeden project manager" or "codeden-website, Improve FAQ", so you can tell sessions apart across projects. Turn it off with **Settings › Voice › Say who's speaking**.
- **Read-aloud queues messages.** When another session finishes while a message is being read, its message now waits and plays next instead of cutting the first one off. Up to three messages wait; messages from sessions you mute, or that arrive in quiet hours, are skipped when their turn comes. Switching read-aloud off stops it and clears the queue.

### Changed

- **A tidier session header.** The model and permission level are shown only under the message box, no longer repeated at the top of a session.

### Fixed

- **Read-aloud no longer reads long reports when a summary can't be made.** If the utility model fails or is unavailable, CodeDen now reads the message's first sentence or two instead of up to 600 characters (or the whole report, when the request itself failed). Summaries that run long are cut to two sentences.
- **Utility model failures are logged.** Failed session titles, follow-ups and read-aloud summaries are written to the server log (`~/.codeden/logs/desktop-server.log` in the desktop app, the terminal for `codeden`) instead of being dropped unless debugging was on.
- **The factory's size limit no longer stops large work.** It used to count every line, including lockfiles and copied-in UI components. A new project's scaffold failed at 800 lines and 40 files, went through a fix round that couldn't succeed, and ended up waiting on you. Now:
  - only code someone has to review counts, so lockfiles and generated or vendored files (shadcn's `components/ui` included) are left out;
  - the default is 5,000 lines with no file limit, and projects on the old defaults move over automatically;
  - the **Merge checks** section of the factory panel's **Limits** dialog sets **Largest change** and **Most files changed**; leave either empty for no limit;
  - the PM sees the limit at triage and splits big work, or accepts work that can't be split (an initial scaffold, a stack migration) as one change;
  - a PR that's still too large goes to the PM to split or allow, with no fix round, without counting towards pausing the loop, and without waiting on you.
- **Saving one factory setting no longer resets the others** to their defaults.

## [0.4.3] - 2026-11-09

### Changed

- The npm page and the desktop app's package metadata now link to the website, [codeden.app](https://www.codeden.app).
- **Livelier PR checks.** In a pull request's checks, a running check shows a spinner, a queued one a softly pulsing dot, and finished ones a tick, a cross or a dash, with short labels ("Running", "Queued", "Passed", "Failed", "Skipped", "Timed out") instead of GitHub's raw status strings. When a check finishes while you're watching, its tick draws in (a cross gives a small shake). The checks badge spins while anything is running and adds a small progress bar until everything passes. With reduced motion turned on, the icons stay still.

## [0.4.2] - 2026-11-09

### Changed

- **Dark factory no longer waits on you.** The project manager and the factory's own sessions used to stop and ask questions, which left the loop waiting. Now they decide from the vision (which wins over the current code) and carry on. Each decision lands in your inbox as **Factory decided** and in the daily digest, with what was decided and why. Calls that are yours to make (protected areas, a missing or self-contradicting vision, anything irreversible outside the code) are flagged as **Factory needs you** without stopping the rest of the work. Sessions you start yourself still ask as usual.

## [0.4.1] - 2026-11-09

### Changed

- **The sidebar reads as a tree.** The rows under a project (Project manager, sessions, Automations, archived) are indented under it with a guide line, and expanded automations nest one level further, so it's clear which project each row belongs to.

## [0.4.0] - 2026-11-08

### Added

- **Open CodeDen from your phone or tablet.** **Settings › Network access** (off by default) lets devices on your network, or on your own VPN such as Tailscale, open CodeDen after signing in with a password. Set one (at least 15 characters; very common passwords and simple sequences are refused) or **Generate** a five-word passphrase, shown once. Turning it on moves only CodeDen's web listener to your network addresses on the same port; agents and the runner carry on. Settings lists every address with a **QR code** to scan, and the signed-in devices with **Sign out** and **Sign out all**. `codeden password` and `codeden network on|off` do the same from a terminal. See [Phones, tablets and network access](docs/remote-access.md).
- **Works on phones and tablets.** The sidebar becomes a slide-out drawer (or stays a slim rail on a tablet in landscape), the right panel opens as a sheet over the transcript, and screens fit without sideways scrolling, with tap targets of at least 40 px and row menus that don't need hover.
- **Add to Home Screen.** CodeDen has a web app manifest and icons, so adding it to your home screen opens it full screen like an app.

### Security

- Network access keeps the runner and the agents' MCP endpoint on 127.0.0.1, never accepts the install token from another device, stores only a salted scrypt hash of the password and hashes of session tokens, throttles failed sign-ins per address (with a 15-minute lockout after ten), and keeps the `Host` and `Origin` checks, extended only to the computer's own network addresses while it's on.

### Fixed

- **Desktop update checks while a release is being published.** The GitHub Release now stays a draft until every installer and update file is attached, so the desktop app no longer reports "Couldn't check for updates … 404" during a release. A release that has no update file for your platform yet counts as up to date, and GitHub hiccups (5xx, timeouts) are retried twice before a plain "Couldn't reach GitHub" message.

## [0.3.0] - 2026-11-08

### Added

- **Create automations in one editor.** **New automation** on a project's Automations page opens a single editor: name and target (this project or all projects); when it runs, as plain choices (every few minutes or hours, daily, weekdays, weekly, monthly, or custom cron) with a summary such as "Every weekday at 09:00", the next three runs and a timezone, or when something happens ("When a pull request's checks fail"), or only when you run it; the prompt with **Insert placeholder**; the agent (provider, model, effort); permissions; and advanced options tucked away. Save it on or off, or **Save and run now**. Templates open in the same editor to tweak first, and everything stays editable on the automation's page, with **Duplicate** and **Delete**. Automations from files show **From file** and offer **Duplicate to edit**.
- **Share automations.** Export one as a Markdown file (download or copy) or a project's as a `.zip`, and **Import** `.md` files, a zip or pasted text, with a preview of each automation and its errors. The files use the same format as `.codeden/automations/`, imports never run anything and always start off, and Full permissions are flagged.
- **Read-only permissions.** A new level below Supervised, so the ladder is **Read-only, Supervised, Auto, Full**, shown as **Permissions** in the composer, the new-session dialog and the automation editor. Read-only agents can read and run checks (tests, lint, type checks) but never edit files, commit or push; Claude enforces it per tool call and Codex with its read-only sandbox.
- **The PM can set up automations.** PMs have `create_automation` and `update_automation`; what they create starts off and is marked **Created by the PM**.
- **Messages from the PM and the orchestrator stand out.** In a session's thread, a message the project manager or the orchestrator sent is a card with the sender's badge and rendered Markdown, instead of a plain user bubble. The sender is recorded with the message.
- **Projects pick up a GitHub remote added later.** A local folder that later gets `git init` and a GitHub `origin` becomes a GitHub project: CodeDen checks again on start, after each agent turn in a local-only project, and with **Check again** in the GitHub tab, the session's Issue / PR panel and the Autonomy dialog. If a GitHub project's `origin` disappears, CodeDen warns instead of downgrading it, and offers **Make local-only**.

### Changed

- **Archiving removes the worktree instantly**: the folder moves to `~/.codeden/wt/.trash` and is deleted in the background. A worktree with uncommitted changes is still kept unless you choose **Remove anyway**, and the toast says when changes were discarded. If a file in the worktree is in use, the toast offers **Try again**, and the hourly cleanup retries archived sessions on its own. The branch and checkpoints stay.

### Fixed

- **A slow-starting runner is no longer killed and relaunched.** CodeDen used to give a new runner 20 seconds, then kill it and start another, forever on a machine where start-up takes longer (security software, a slow disk). It now waits for a runner that is still starting (up to five minutes), the sidebar says **Starting the runner…**, and a runner that crashes during start-up is reported at once with the end of `logs/runner.log`.
- **Dictation and pasted images in a new orchestrator or PM chat.** Before its first message, the orchestrator and PM chats now have the full composer input: the dictation button and shortcuts, image and file paste, drag-and-drop and the attach button. The first message, which starts the session, carries its images.
- **Archiving no longer leaves half-deleted worktrees on Windows.** Git deletes the contents of folders that a pnpm `node_modules` junction points to, and it stops at a dangling junction, so removing a pnpm-installed worktree failed halfway with "is not a working tree". CodeDen now deletes worktrees itself without ever following a symlink or junction. It cleans up the folders earlier versions left behind for archived sessions (about a minute after CodeDen starts), and recreates a session's worktree over such a leftover. If a file is in use, nothing is deleted and the toast offers **Try again**.
- **Long questions and answers in question cards wrap** instead of overflowing; long answered questions are clamped with **Show more**.
- **A session started just as the runner connects is no longer marked failed.** Recovery after a runner restart could mistake it for a session cut off by the restart.
- **The PM and the orchestrator no longer miss an update that arrives while they are being woken.** Such a notice (for example, that an agent finished) used to stay undelivered until something else woke them.

## [0.2.0] - 2026-11-08

### Added

- **Local Whisper dictation.** A new **Local (Whisper)** dictation engine transcribes on your own machine, offline, in any browser and in the desktop app. Pick a model in Settings > Voice (tiny, base or small, English-only or multilingual), download it with live progress (resumable, checksum-verified, deletable) and try it with **Test**; first-run setup offers it too. Where the browser has no working speech recognition, CodeDen now says so and suggests Local (Whisper).
- **The desktop app.** CodeDen for Windows, macOS and Linux as an installable app, from GitHub Releases: no Node.js needed, same data as `npx codeden` (it attaches to a running CodeDen or starts its own). Its own window, a tray (menu bar) icon with running and waiting agents, the app icon badge, system notifications, the system folder picker for new projects, `codeden://` links, keep-awake while agents run, open at login and close to tray (**Settings > App**). It updates itself from GitHub Releases through the same update banner and **Updates** setting, stopping the runner gracefully before installing so sessions resume afterwards. See [The desktop app](docs/desktop.md).
- Claude Code support installs without npm when there is none (straight from the registry, checked against its published checksum).
- **Archive sessions.** **Archive session** in the session menu stops the session, hides it from the sidebar and removes its worktree; **Unarchive** (or sending it a message) brings it back.
- **Worktree cleanup.** Worktrees of sessions inactive for 7 days are removed automatically, unless the pull request is still open or there are uncommitted changes; archiving a project cleans up its sessions' worktrees. Configure it in Settings > General > Worktrees. Branches and checkpoints are kept, and the worktree is recreated from its branch the next time you message the session.
- **Know when an agent is waiting on you.** When an approval or a question arrives, CodeDen plays a short chime (once per burst; Settings > Notifications > **Sound when an agent needs you**, with a Test button) and keeps a toast on screen until you open the item or it is resolved; **Open** goes straight to the session. While anything is waiting, the tab icon gets an amber dot and a background tab's title alternates with "⏳ Waiting on you". The first such toast offers, once, to turn on desktop notifications.
- **One picker for provider, model and effort.** A single control in the composer, the new-session dialog, automations and Settings, with search across providers, favourites and hidden models.
- **Custom model ids.** Add model ids a provider doesn't list, per provider, in Settings > Providers; they appear in the picker marked Custom.
- **Claude Code's real model list** loads as soon as CodeDen starts, without running a session or sending a request.
- **Change autonomy on a running session.** The composer's autonomy picker now changes the live session: Claude from the next tool call, Codex from the next turn.
- **Queued messages you can see.** Messages sent while the agent is busy wait in a tray above the composer, where you can edit, delete or send them now (steering the running turn).
- **Pin and reorder projects** in the sidebar, with row menus for sessions and projects and a home for archived sessions.

### Fixed

- Risky-action checks read commands like a shell: they follow `cd`, and multi-line arguments such as heredoc commit messages are no longer split into separate commands. Writes to the OS temp folder no longer ask in Auto and Full.
- Turn diffs and checkpoints could miss a file rewritten in the same second as the snapshot (seen on Linux).
- Pasted images show from their artifact instead of a file path, and long tool-call summaries stay inside the transcript column.
- `codeden stop` also stops a runner that the server was still starting when it shut down (for example right after an update), so no runner is left running in the background.
- **Codex models in the model pickers.** Codex's full model list, with each model's reasoning efforts, shows up as soon as CodeDen starts, with no need to run a Codex session or reload the page first. It is loaded again after a setup re-check (for example once you have logged in), and new model lists reach open pages live. Choosing **Max** for a Codex model that offers it now sends `max` instead of `xhigh`.

## [0.1.1] - 2026-11-07

### Added

- **One-click updates.** CodeDen checks npm on start and every 6 hours; a banner offers the new version with **What's new** (release notes), **Update now** and **Later**. Update now installs the version side by side into `~/.codeden/app/<version>/`, restarts CodeDen into it and reconnects the page; running sessions are drained and resumed. Progress, failures with Retry, and a manual restart command when CodeDen can't restart itself.
- The `codeden` launcher: any copy you run (npx, global) starts the newest installed version from `~/.codeden/app/current.json`, in the same process. Source checkouts never switch.
- `codeden update` and `codeden update --rollback`; **Roll back** in Settings > About; `codeden doctor` lists installed versions and which one starts.
- Settings > General > **Updates**: Off, Notify me (default) or Install automatically (downloads in the background for the next launch).

### Changed

- The update check runs every 6 hours instead of once a day, and the "Check for updates" switch became the Updates setting (an existing "off" stays off).
- The published entries read their version from `package.json` at runtime.

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
