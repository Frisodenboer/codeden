# Security policy

CodeDen runs coding agents on your machine with access to your repositories and your existing CLI logins, so security reports are taken seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately instead:

1. Go to the repository's **Security** tab on GitHub and choose **Report a vulnerability** (GitHub private vulnerability reporting): <https://github.com/leonvanzyl/codeden/security/advisories/new>.
2. Include what you found, the CodeDen version (`codeden --version`), your OS, and steps to reproduce. A proof of concept helps, but please keep it minimal.

You should get an acknowledgement within a few days. Once the issue is confirmed, a fix is prepared privately, released, and the advisory is published with credit to you unless you'd rather stay anonymous.

## Scope

In scope: anything that lets another website, another local user or process, or an agent escape the protections described in [docs/security.md](docs/security.md). For example:

- reaching the local API, WebSocket or MCP endpoint without the install token, or from another origin;
- an agent's MCP token reaching tools outside its role or another session's data;
- tokens or API keys leaking into logs, transcripts, files or agent environments;
- the orchestrator or a PM writing project code;
- an automatic merge bypassing a merge check, a protected area or the kill switch.

Out of scope: what an agent does with the permissions you gave it (for example under **Full autonomy**), vulnerabilities in Claude Code, Codex, `gh` or other tools CodeDen runs (report those to their maintainers), and attacks that need an already compromised user account.

## Supported versions

Security fixes go into the latest release. Update with `npx codeden@latest`.
