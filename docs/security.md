# Security

CodeDen runs coding agents on your machine with your logins. Its security model keeps the local API private to you, keeps credentials out of files and transcripts, and puts risky agent actions in front of you before they happen.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Network

- The **server and the runner listen on 127.0.0.1 only.** Nothing is exposed to your LAN or the internet. Remote and mobile access are not part of v1; when they come they'll be explicit opt-in with a password or pairing.
- **Every request needs the install token**: a random 256-bit token in `~/.codeden/install-token`, created on first run (readable only by you where the OS supports file modes). It's required on every HTTP, WebSocket and MCP request, and compared in constant time.
- **The browser gets the token once**, through the launch URL that `codeden` opens. The server swaps it for an **HttpOnly, `SameSite=Strict` cookie** and redirects to a clean URL, so the token doesn't linger in your address bar or history. Opening CodeDen without it shows a "CodeDen is locked" page.
- **`Host` must be a loopback name** (`127.0.0.1`, `localhost`, `[::1]`), which blocks DNS-rebinding attacks.
- **`Origin`, when present, must be CodeDen's own**, which blocks other websites, including other apps on other localhost ports.
- The cookie name includes the port, so two installs side by side don't clash.

## Agents and MCP

- Each agent session gets its own **MCP token** for CodeDen's internal MCP server, minted when the session starts or resumes, **stored only as a SHA-256 hash**, and **revoked** when the session stops, completes or fails. The install token is not accepted on the MCP endpoint, and MCP tokens are not accepted by the UI API.
- Tokens are **role-scoped**: the orchestrator, PMs and agents see only the tools for their role; others aren't even listed. Browser tools always act on the caller's own session, and no tool takes another session's id.
- Agents reach CodeDen through a **local MCP proxy in the runner** on `127.0.0.1`. The token is passed to Codex over stdin, never on a command line.
- **Agent environments** inherit your environment minus CodeDen's own secrets: `CODEDEN_*` variables whose names contain `TOKEN`, `SECRET`, `KEY` or `PASSWORD` never reach agents, terminals or setup scripts. (Your other environment variables are passed through, as they would be in your own terminal.)
- Tokens are never logged or written into transcripts.

## The orchestrator and PMs can't write code

They run read-only: Claude gets no edit tools and a policy that denies writing commands, and Codex runs in a read-only sandbox. They act only through CodeDen's tools.

## Autonomy levels

Each session runs at an autonomy level (the default comes from **Settings → Autonomy**; change it per session in the composer). Each level maps onto the provider's **native** enforcement:

| Level | Claude Code | Codex |
|---|---|---|
| **Supervised**: every edit and command asks | Default permission mode, and every edit or command is routed to an approval | `untrusted` approvals, workspace-write sandbox |
| **Auto, risky actions ask** (default) | `acceptEdits`, plus CodeDen's risk classifier on every tool call | `on-request` approvals, workspace-write sandbox, network off |
| **Full autonomy**: no approvals inside the worktree | `bypassPermissions`; only writes outside the worktree ask | `never`, workspace-write sandbox, network on |

Under **Auto**, edits and ordinary commands inside the worktree run freely, and these go to an approval card (and your inbox):

- writes or deletes **outside the worktree**, and changes to global git config;
- **force pushes**, deleting branches, tags or refs;
- **global installs** (`npm -g`, `pip` outside a project, system package managers) and elevated commands (`sudo`);
- **piping a downloaded script into a shell** or executing a download;
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

Everything stays in `~/.codeden/` on your machine. CodeDen has no accounts and no hosted backend, and sends no telemetry. The only outbound traffic is your agents talking to their providers, GitHub through your `gh` login, and the optional image and voice engines you turn on.
