# Security

CodeDen runs coding agents on your machine with your logins. Its security model keeps the local API private to you, keeps credentials out of files and transcripts, and puts risky agent actions in front of you before they happen.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Network

- By default the **server and the runner listen on 127.0.0.1 only.** Nothing is exposed to your LAN or the internet.
- **Network access is opt-in** (Settings › Network access, or `codeden network on`): it needs a password and then moves only the server's web listener to all interfaces on the same port, so phones and tablets on your network or VPN can sign in. The runner, its MCP proxy and the agents' `/mcp` endpoint stay on 127.0.0.1. See [Network access](#network-access) below and [Phones, tablets and network access](remote-access.md).
- **Every local request needs the install token**: a random 256-bit token in `~/.codeden/install-token`, created on first run (readable only by you where the OS supports file modes). It's required on every HTTP, WebSocket and MCP request, and compared in constant time.
- **The browser gets the token once**, through the launch URL that `codeden` opens. The server swaps it for an **HttpOnly, `SameSite=Strict` cookie** and redirects to a clean URL, so the token doesn't linger in your address bar or history. Opening CodeDen without it shows a "CodeDen is locked" page.
- **`Host` must be a loopback name** (`127.0.0.1`, `localhost`, `[::1]`), which blocks DNS-rebinding attacks.
- **`Origin`, when present, must be CodeDen's own**, which blocks other websites, including other apps on other localhost ports.
- The cookie name includes the port, so two installs side by side don't clash.

### Network access

Off by default. When you turn it on:

- **A password is required.** At least 15 characters; very common passwords, repeats and simple sequences are refused. Only a **salted scrypt hash** is stored (`~/.codeden/remote-access.json`, mode 0600 where supported). CodeDen refuses to bind beyond 127.0.0.1 without one, at startup too. Changing it signs out every remote device.
- **Remote means "not loopback"**, judged from the connection's peer address (`127.0.0.0/8`, `::1` and their IPv4-mapped forms are local). `X-Forwarded-*`, `Forwarded` and `X-Real-IP` are never read.
- **Remote devices sign in with the password** and get a random session token in an **HttpOnly, `SameSite=Lax` cookie** (`Secure` over HTTPS), valid for 90 days. Only its SHA-256 hash is stored, with the device's user agent and when it was last seen. **The install token is never accepted from a remote device**, in a header, a cookie or `?token=`.
- **Failed sign-ins are throttled per address:** after three, each attempt waits 1 s, 2 s, 4 s … up to 30 s; ten in 15 minutes lock the address out for 15 minutes. Only failures count, other devices are unaffected, and each failure is logged with its address (never the password) in `~/.codeden/logs/remote-access.log`.
- **Reachable remotely, behind the session:** the web UI, the HTTP API and the UI WebSockets. **Never reachable remotely:** `/mcp` (404), the runner and its MCP proxy (still 127.0.0.1), and changing network access or the password (403; this computer or the CLI only).
- **`Host`** may also be one of this computer's own LAN or VPN addresses on CodeDen's port while access is on, and **`Origin`** may be the matching `http://<address>:<port>`. Other hosts, other ports, foreign origins and `null` origins are refused.
- **Signed-in devices** are listed in Settings with **Sign out** and **Sign out all**; signing out (or turning access off) also closes their open connections.
- Network access serves plain **http**: use it on networks you trust, or over your own VPN (Tailscale, WireGuard). Never forward the port to the internet.

## Agents and MCP

- Each agent session gets its own **MCP token** for CodeDen's internal MCP server, minted when the session starts or resumes, **stored only as a SHA-256 hash**, and **revoked** when the session stops, completes or fails. The install token is not accepted on the MCP endpoint, and MCP tokens are not accepted by the UI API.
- Tokens are **role-scoped**: the orchestrator, PMs and agents see only the tools for their role; others aren't even listed. Browser tools always act on the caller's own session, and no tool takes another session's id.
- Agents reach CodeDen through a **local MCP proxy in the runner** on `127.0.0.1`. The token is passed to Codex over stdin, never on a command line.
- **Agent environments** inherit your environment minus CodeDen's own secrets: `CODEDEN_*` variables whose names contain `TOKEN`, `SECRET`, `KEY` or `PASSWORD` never reach agents, terminals or setup scripts. (Your other environment variables are passed through, as they would be in your own terminal.)
- Tokens are never logged or written into transcripts.

## The orchestrator and PMs can't write code

They always run read-only, whatever their level: Claude gets no edit tools and a policy that denies writing commands (checks included), and Codex runs in a read-only sandbox. They act only through CodeDen's tools.

## Permissions

Each agent session and each automation runs at a **permission level**, from Read-only to Full. The default comes from **Settings → Autonomy**; change it per session in the composer's **Permissions** picker or the new-session dialog, and per automation in its editor. Each level maps onto the provider's **native** enforcement:

| Level | Claude Code | Codex |
|---|---|---|
| **Read-only**: can read and run checks, but never edits files, commits or pushes | Default permission mode; a PreToolUse hook denies the edit tools and every shell command that is not on the read-only allowlist | `never` approvals, **read-only sandbox**, network off: writes fail instead of asking |
| **Supervised**: asks before edits and commands | Default permission mode, and every edit or command is routed to an approval | `untrusted` approvals, workspace-write sandbox |
| **Auto**: works freely in its worktree and asks only for risky actions (default) | `acceptEdits`, plus CodeDen's risk classifier on every tool call | `on-request` approvals, workspace-write sandbox, network off |
| **Full**: never asks | `bypassPermissions`; only writes outside the worktree ask | `never`, workspace-write sandbox, network on |

Read-only is offered only on providers that report the `readOnly` capability (Claude Code and Codex both do); the server refuses it elsewhere. Under Read-only:

- **Claude** may run commands that only read (`ls`, `cat`, `rg`, `git status`/`log`/`diff`/`show`, `gh ... view`/`list`/`checks`, and their PowerShell equivalents) and the project's **checks**: `npm`/`pnpm`/`yarn`/`bun` `test`, `lint`, `typecheck` or `check`, `tsc`, `vitest`, `jest`, `eslint`, `biome check`, `ruff check`, `pytest`, `mypy`, `cargo test`/`check`/`clippy` and `go test`/`vet`. Fix, write, snapshot-update and watch flags (`--fix`, `--write`, `-u`, `--watch`, ...), output redirection and command substitution are refused, as are installs, builds, commits and pushes. Checks run the project's own scripts, so a test that writes files (coverage, caches) can still write them; the agent itself cannot.
- **Codex** runs every command in its read-only sandbox, so checks run but any write fails.
- **CodeDen's `create_pull_request`** is hidden from read-only sessions and refused if called. Commenting on issues and attaching screenshots as evidence still work, so the agent can report what it found.

Changing the level while a session runs is saved on the session and sent to the running agent. Claude follows it from its next tool call, into and out of Read-only too; Codex from its next turn (the composer tells you which). Approvals that are already waiting stay waiting.

## Automations

Automations run unattended, so they use the same permission levels with safer defaults around them: new, imported and PM-created automations always start **off**, an import never runs anything and warns about Full permissions, and imports are parsed with the same validation as automation files, within limits on file count and size. See [Automations](automations.md#sharing-export-and-import).

**The OS temp directory counts as part of the workspace** under Auto and Full: writing or deleting files in `os.tmpdir()`, `%TEMP%`/`%TMP%`, `$TMPDIR` or `/tmp` (including Git Bash's `/tmp` on Windows) doesn't ask, and Codex's sandbox may write there. Only the temp directories themselves qualify, never a filesystem root or your home directory, even if an environment variable points there. Secrets files written to temp still ask, and Supervised still asks for everything.

Under **Auto**, edits and ordinary commands inside the worktree run freely, and these go to an approval card (and your inbox):

- writes or deletes **outside the worktree** (and outside the OS temp directory), and changes to global git config;
- **force pushes**, deleting branches, tags or refs;
- **global installs** (`npm -g`, `pip` outside a project, system package managers) and elevated commands (`sudo`);
- **piping a downloaded script into a shell** or executing a download (`curl … | sh`, `irm … | iex`, `curl … | python3`). Piping a download into a program that only reads it as data, such as `node -e '…'`, `python -c '…'`, `jq` or a script file in the project, runs freely;
- **secrets access**: reading or writing secrets files, dumping the environment;
- network fetches to hosts not on the allowed list, where a list applies.

When you approve, you can approve once or for the rest of the session.

## Credentials

- **Provider logins** (Claude Code, Codex) stay with their CLIs. CodeDen runs your installed `claude` and `codex`, which use their own logins; it never implements a login and never sees your password.
- **GitHub** is read from `gh auth token` at runtime and kept in memory only.
- **Optional API keys** (ElevenLabs, OpenAI, Gemini, a fallback GitHub token) go into the **OS keychain** (Windows Credential Manager, macOS Keychain, Secret Service on Linux) through `@napi-rs/keyring`. They're never written to files or returned by the API, and cloud voice keys never reach the browser. If no keychain is usable, keys are kept in memory for the current run only.
- `settings.json` and `usage-settings.json` hold no secrets.

## Files

- Agents work in their own **worktrees** under `~/.codeden/wt/`. Checkpoints use hidden refs and a temporary index, so your branch and index are untouched.
- The **agent-config editors** can only reach known agent-config locations; `.git`, credential files and `..` paths are refused, and every overwrite is backed up first.
- **Image generation** writes only inside the session's worktree (never `.git`, never through a symlink that escapes).
- The **browser** refuses `chrome://`, `edge://`, `devtools://` and `javascript:` URLs, and each session has its own browser context.

## Automatic merges

Automatic merging only exists in the experimental Autopilot and Dark factory modes, behind merge checks, protected areas and server-enforced limits, with a kill switch. See [Autonomy and the dark factory](autonomy-and-dark-factory.md).

## Data and telemetry

Everything stays in `~/.codeden/` on your machine. CodeDen has no accounts and no hosted backend, and sends no telemetry. The only outbound traffic is your agents talking to their providers, GitHub through your `gh` login, the optional image and voice engines you turn on, and, unless you set **Updates** to *Off* in Settings > General, a request on start and every 6 hours to the npm registry for the latest `codeden` version (nothing about you or your projects is sent). Installing an update downloads that version from npm, and **What's new** fetches its release notes from GitHub when you open it.
