# The CodeDen desktop app

The desktop app is CodeDen as an app on your computer: its own window, a tray (menu bar) icon that shows what your agents are doing, notifications, a badge for things waiting on you, and automatic updates. It runs the same server, runner and UI as `npx codeden`, on the same data, so you can use either and switch whenever you like.

You don't need Node.js or npm for the desktop app. You still need the tools your agents use (git, and Claude Code and/or Codex), exactly as with `npx codeden`.

## Install

Download the installer for your system from the [latest GitHub Release](https://github.com/leonvanzyl/codeden/releases/latest):

| System | File | Notes |
|---|---|---|
| Windows 10/11 (x64) | `CodeDen-Setup-<version>.exe` | Installs for your user only (no admin prompt) into `%LOCALAPPDATA%\Programs\CodeDen`, with Start menu and desktop shortcuts and an uninstaller (Settings > Apps) |
| macOS (Apple silicon) | `CodeDen-<version>-arm64.dmg` | Drag CodeDen to Applications |
| macOS (Intel) | `CodeDen-<version>-x64.dmg` | |
| Linux (x64) | `CodeDen-<version>-x86_64.AppImage` | `chmod +x` it and run it; it can update itself |
| Debian/Ubuntu (x64) | `codeden_<version>_amd64.deb` | `sudo apt install ./codeden_<version>_amd64.deb` |

### Unsigned builds

Releases are signed only when the project's signing certificates are configured. An unsigned build works, but the OS warns you the first time:

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS:** Gatekeeper refuses to open an app from an unidentified developer. Right-click CodeDen in Applications, choose **Open**, then **Open** again (or allow it under System Settings > Privacy & Security). **An unsigned macOS app can't update itself**: macOS only installs updates into an app signed with a Developer ID, so download new versions by hand. Settings > About says when this applies.

## First launch

The app uses the same data folder as `npx codeden`: `~/.codeden` (or `CODEDEN_HOME`). On launch it:

1. **Attaches** to a CodeDen server that is already running for that folder (for example one you started with `npx codeden`), or
2. **starts its own** server on port 4317 (or any free port if 4317 is taken), which starts the runner as usual.

Then the window opens on the UI, already signed in. A first launch shows the same setup checklist as the browser; it reports Node.js as "built into the app".

## The window and the tray

- **Closing the window** keeps CodeDen running in the tray (Windows, Linux) or menu bar (macOS), so agents, automations and notifications carry on. Click the tray icon (or choose **Open CodeDen**) to bring it back. Turn this off under **Settings > App > Keep running in the tray**.
- **The tray** shows how many agents are running and how many are waiting on you, plus the inbox count, and has **Open the inbox**, the next update step when there is one, and **Quit CodeDen**.
- **Quit** really quits: it closes the window and the server. Like stopping `codeden` with Ctrl+C, the **runner keeps running**, so agents in the middle of a turn finish it, and the next launch picks everything up again. To stop the agents too, run `npx codeden stop` (or stop the sessions first).
- **Badge.** The number of things waiting on you appears on the app icon (the dock on macOS, a dot on the taskbar button on Windows, the launcher on Linux desktops that support it).
- **Notifications** are the system's own (Settings > Notifications > System notifications). Clicking one brings the window to the front on the right page.
- **Keep awake.** While an agent is running, CodeDen keeps the computer from going to sleep (the screen can still turn off). Settings > App > Keep the computer awake.
- **Open at login** (Windows, macOS): Settings > App > Open at login starts CodeDen in the tray when you log in.
- **Adding a project** uses the system folder picker. "Browse folders in CodeDen instead" opens the in-app browser if you prefer it.
- **Zoom** makes the whole UI larger or smaller in 10% steps, from 50% to 200% (View menu). The keys work even when the menu bar is hidden:

  | Action | Windows, Linux | macOS |
  |---|---|---|
  | Zoom in | Ctrl+= or Ctrl+Shift+= (Ctrl+Plus), Ctrl+Num+ | Cmd+= or Cmd+Shift+=, Cmd+Num+ |
  | Zoom out | Ctrl+- or Ctrl+Shift+-, Ctrl+Num- | Cmd+- or Cmd+Shift+-, Cmd+Num- |
  | Actual size (100%) | Ctrl+0, Ctrl+Num0 | Cmd+0, Cmd+Num0 |

- The window remembers its size, position and zoom (also after a reload or a restart).

### Links

The app registers `codeden://` links:

| Link | Opens |
|---|---|
| `codeden://` | Home |
| `codeden://inbox` | The inbox |
| `codeden://session/<id>` | A session |
| `codeden://project/<id>` | A project |
| `codeden://settings/<section>` | A settings page, e.g. `codeden://settings/about` |

Opening a link while CodeDen runs brings the window to the front on that page; otherwise it starts CodeDen there. Only one copy of the app runs per data folder.

## Updates

The desktop app updates itself from GitHub Releases, following **Settings > General > Updates**:

- **Notify me** (default): CodeDen checks on start and every 6 hours (only the release metadata is fetched). The update banner offers the new version with **What's new**, **Update now** and **Later**. **Update now** downloads it with progress, then stops the runner gracefully (as `codeden stop` does), installs the update and starts the new version; running sessions resume where they left off.
- **Install automatically**: new versions download in the background and install when you quit CodeDen (or right away with **Restart now** in the banner, or **Restart to update** in the tray).
- **Off**: no checks.

Notes:

- The npm self-update (`codeden update`, side-by-side versions in `~/.codeden/app`) is off in the desktop app; the app replaces itself instead. If the app attached to a server you started with `npx codeden`, the banner is about that npm install, and the app updates itself on its own (with a notification and the tray menu).
- macOS needs a signed app to update (see above). The Debian package updates through the downloaded `.deb` (it asks for your password); the AppImage replaces itself.
- If an update fails, the banner shows why, with **Retry**. You can always install a newer release by hand over the old one.

## Where things live

| What | Where |
|---|---|
| Your data (database, settings, worktrees, logs) | `~/.codeden` (shared with `npx codeden`; `CODEDEN_HOME` or `--home` to change it) |
| The app's own profile (window state, cookies, cache) | `~/.codeden/desktop` |
| App logs | `~/.codeden/logs/desktop.log` and `desktop-server.log` (Help > Show Logs) |
| Claude Code support (installed on first use) | `~/.codeden/deps` |
| The app itself | Windows: `%LOCALAPPDATA%\Programs\CodeDen`; macOS: `/Applications/CodeDen.app`; Linux: wherever you keep the AppImage, or `/opt/CodeDen` for the `.deb` |
| Downloaded updates | Windows: `%LOCALAPPDATA%\codeden-updater`; macOS: `~/Library/Caches/codeden-updater`; Linux: `~/.cache/codeden-updater` |

Claude Code support (the Claude Agent SDK) is not part of the app: on first use it is downloaded from the npm registry into `~/.codeden/deps`, checked against its published checksum, without needing npm.

Uninstalling the app leaves `~/.codeden` alone; delete it yourself to remove your data.

## Command line

The app accepts a few options (for example in a shortcut):

```text
CodeDen [--home <dir>] [--port <n>] [--hidden] [codeden://...]
```

`--home` uses another data folder (a separate, independent CodeDen), `--port` picks the port for a server the app starts, and `--hidden` starts in the tray.

## Security

The window shows only the local server's UI: it is sandboxed and isolated from Node.js, the page gets a small, typed bridge for notifications, the badge, the folder picker and links, and every call is checked in the app. Navigation away from the local server is blocked; other links open in your browser. The page may use notifications, the microphone (dictation) and the clipboard, and nothing else. The app never opens a debugging port. Everything else is as described in [Security](security.md): loopback only, the per-install token, no telemetry.
