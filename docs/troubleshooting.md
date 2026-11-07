# Troubleshooting

## Start with `doctor`

```sh
npx codeden doctor
```

It runs the same checks as the setup screen and prints one line per item, then the command that fixes each problem:

```
ok  CodeDen              0.1.0
ok  Data directory       C:\Users\you\.codeden
ok  Server               running on port 4317 (pid 12345)
ok  Runner               running on port 51234 (pid 12346)
ok  Terminals            node-pty
ok  Keychain             @napi-rs/keyring
ok  Claude Code          2.1.318 - Signed in
ok  Claude Code support  SDK 0.3.318 in C:\Users\you\.codeden\deps
--  Codex                Codex is not installed
ok  GitHub CLI           2.83.0 - Signed in
ok  git                  2.51.0 - Identity configured
ok  Browser              Microsoft Edge
ok  Node.js              Node.js 24.16.0

To fix:
  Codex: npm install -g @openai/codex
```

`ok` passed, `!!` is a warning, `--` is missing, `xx` is an error. `doctor` exits non-zero when CodeDen can't run a session (no signed-in agent provider, or Node or git missing). Use `--home <dir>` to check another data directory.

## Logs and state

| What | Where |
|---|---|
| Runner output | `~/.codeden/logs/runner.log` |
| Server log lines | Run with `CODEDEN_DEBUG=1 codeden` to print them in the terminal |
| Running server | `~/.codeden/server.json` (port and pid) |
| Running runner | `~/.codeden/runner/runner.json` (port, pid and version) |
| Database | `~/.codeden/codeden.db` (SQLite, WAL mode) |
| Config-file backups | `~/.codeden/backups/` |
| Claude Code support (Claude Agent SDK) | `~/.codeden/deps/` |

On Windows `~` is your user folder, for example `C:\Users\you\.codeden`. If you set `CODEDEN_HOME` or `--home`, look there instead.

## Common problems

### "Port 4317 is in use"

Another program (or another CodeDen with a different home) has the port. Start on another one:

```sh
codeden --port 4400
```

If it's a stale CodeDen, `codeden stop` then start again.

### The page says "CodeDen is locked"

The browser doesn't have the install token cookie, for example after clearing cookies, using another browser, or changing the port. Run `codeden` again: it prints and opens an authenticated link, even when CodeDen is already running.

### "CodeDen needs Node.js 24 or newer"

Install Node.js 24 or later from <https://nodejs.org>, or with your version manager (`nvm install 24`, `fnm install 24`, `volta install node@24`). Check with `node --version` in the same terminal you run `npx codeden` from.

### Claude Code or Codex shows as not signed in

Use **Sign in** on the setup checklist, or run the CLI's own login in a terminal and re-check:

```sh
claude auth login
codex login
gh auth login
```

A Claude login close to expiry shows as a warning; signing in again clears it.

### "Claude Code support could not be installed"

CodeDen doesn't ship the Claude Agent SDK. The first time it's needed (on the setup screen, or by the first Claude session), CodeDen installs it from npm into `~/.codeden/deps/`. That's about 5 MB, without the SDK's platform binaries or peer packages. If the install fails, the setup row and the session error show npm's reason, usually a network, proxy or registry problem. Fix that, then retry in one of these ways:

- **Retry** on the Claude Code support row (Settings > First-run setup).
- Start the Claude session again.
- Run `npx codeden doctor --install`, which prints npm's output as it installs.

npm uses your normal configuration (`.npmrc`, `npm_config_registry`, proxy settings). If the folder ends up broken, delete `~/.codeden/deps/` and retry. A `.install.lock` left by a crashed install is cleared automatically once its process is gone, or after 10 minutes.

### An update failed or won't apply

One-click updates install into `~/.codeden/app/<version>/` with npm, then CodeDen restarts into the new version (see [Updating](../README.md#updating)).

- **"Couldn't update to X: npm install exited ..."**: npm's reason follows, usually a network, proxy or registry problem. npm uses your normal configuration (`.npmrc`, proxy settings). Fix it, then press **Retry**, or run `codeden update` to see npm's full output.
- **"Update installed. Restart CodeDen to finish"**: CodeDen couldn't restart itself (it wasn't started by the `codeden` command, or the new version didn't answer within two minutes). Run `codeden stop`, then start it again the usual way; the new version starts.
- **"CodeDen X exited before it started"**: the new version crashed on start, so CodeDen went back to the old one and shows the error. Check the terminal output, then retry or report it. `codeden update --rollback` (or **Roll back** in Settings > About) also goes back.
- **"CodeDen X ... can't start (...); running Y instead"**: the installed version's files are incomplete (an interrupted install, cleaned folder or antivirus). Run `codeden update` to reinstall it, or delete `~/.codeden/app/<version>/` and `~/.codeden/app/current.json` to run the copy you launched.
- **`codeden` still starts the old version**: run `codeden doctor` and look at *Launched copy*, *Installed versions* and *Current version*. A copy you launched that is newer than the installed one always wins (for example after `npm i -g codeden@latest`), and a source checkout never switches.
- **`npx` keeps an old copy**: that's fine: the npx copy only launches the version in `~/.codeden/app`. To refresh npx's own copy, run `npx codeden@latest` once.
- A `.install.lock` in `~/.codeden/app` left by a crashed install is cleared once its process is gone, or after 10 minutes. Old versions are pruned to the current and previous ones; a folder still in use on Windows is removed on a later update.

### "older than the tested minimum"

CodeDen pins the Claude Agent SDK and the Codex protocol to versions it has been tested against, and reports CLIs that are too old (Claude Code 2.1.250+, Codex 0.160.0+). Update them:

```sh
claude update
npm install -g @openai/codex@latest
```

### "Runner did not start in time"

Look at `~/.codeden/logs/runner.log` for the error. A native module that failed to load (`node-pty`) usually means a broken or partial install: run `npm cache clean --force`, then `npx codeden@latest`. Security software that blocks new processes can also cause it.

### Agents keep running after I close the terminal

That's by design: the runner outlives the server so agents survive restarts. `codeden stop` stops both.

### The browser panel is empty or says no browser was found

CodeDen uses an installed **Microsoft Edge** or **Google Chrome**. Install one, then re-check from the setup screen. The browser starts the first time you or an agent opens it.

### GitHub features are missing

- The folder needs a GitHub remote (`git remote -v`).
- `gh auth status` must show you signed in. **Settings → GitHub** shows what CodeDen sees.
- If you set `CODEDEN_GITHUB_SYNC=0`, polling is off.

### An automation didn't run

Check, in order: the master switch (**Settings → General → Automations**), the project's automations switch, the automation's own switch, whether the PM paused it, and its **Runs** tab. Skipped runs say why (`overlap`, `quiet_hours`, `daily_cap`, `factory_intake`, ...). A file automation with a YAML error is listed with the error on the Automations page.

### The factory isn't doing anything

Open the factory panel. A **paused** loop shows its reason (budget reached, repeated failures, a revert); resume it once you've looked. A **stopped** loop means a kill switch is on, either the project's or **Settings → General → Global factory kill switch**. Only issues opened after you enabled the mode, or labelled `codeden-factory`, are picked up.

## Windows notes

CodeDen is tested on Windows first. Things worth knowing:

- **Install the CLIs normally.** The native Claude Code installer (`claude.exe`) and the npm `claude.cmd` / `codex.cmd` shims all work; CodeDen unwraps npm shims itself, so no shell is involved.
- **Terminal shell.** Terminals open **PowerShell** (`powershell.exe`). To use PowerShell 7 or Git Bash, set `CODEDEN_SHELL` before starting, for example in PowerShell:

  ```powershell
  $env:CODEDEN_SHELL = "pwsh.exe"; npx codeden
  ```

- **Long paths.** Worktrees live under short paths (`~/.codeden/wt/<project>/<session>/`) to stay clear of the 260-character limit, but very deep repositories can still hit it. Enable long paths in git with `git config --global core.longpaths true`.
- **Keychain.** API keys are stored in **Windows Credential Manager** under the service name `codeden`. If the keychain module can't load, CodeDen keeps keys in memory until it stops (start with `CODEDEN_DEBUG=1` to see why).
- **Files in use.** Antivirus scanners and editors with the worktree open can briefly lock files; if removing a session's worktree fails, close what has it open and try again.

## Starting fresh

To reset CodeDen completely, stop it and remove the data directory. This deletes your projects list, sessions, transcripts, usage history and worktrees under `~/.codeden/wt/` (commit or push anything you want to keep first). Your repositories and your provider, GitHub and keychain logins are not touched.

```sh
codeden stop
# then delete ~/.codeden (or your CODEDEN_HOME)
```

Still stuck? [Open an issue](https://github.com/leonvanzyl/codeden/issues) with the `codeden doctor` output and the end of `runner.log` (check it for anything private first).
