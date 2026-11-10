import type { DesktopUpdatePhase, UpdateMode } from "@codeden/contracts";

export const SIX_HOURS = 6 * 3600_000;

/**
 * Why this build cannot update itself, or null when it can. A run from the repository has no
 * release feed; macOS only installs updates into an app signed with a Developer ID.
 */
export function updateSupport(opts: {
  packaged: boolean;
  platform: NodeJS.Platform;
  /** macOS: the app carries a Developer ID signature. */
  macSigned: boolean;
}): string | null {
  if (!opts.packaged) return "Updates are installed by the desktop app's installed builds only.";
  if (opts.platform === "darwin" && !opts.macSigned) {
    return "This macOS build isn't signed with a Developer ID, so it can't update itself. Download new versions from GitHub Releases.";
  }
  return null;
}

/**
 * The next updater step when the app checks on its own: when it attached to a server started
 * by `codeden`, that server's update banner is about the npm install, so the app follows
 * `settings.updates.mode` itself. Check on launch and every 6 hours (`off`: never);
 * `auto` downloads what it finds, `notify` leaves it to the tray menu.
 */
export function standaloneAction(input: {
  mode: UpdateMode;
  phase: DesktopUpdatePhase;
  unsupported: string | null;
  /** When the last check finished (ms), null when never. */
  checkedAt: number | null;
  now: number;
}): "check" | "download" | null {
  if (input.unsupported || input.mode === "off") return null;
  if (input.phase === "available") return input.mode === "auto" ? "download" : null;
  if (input.phase !== "idle" && input.phase !== "error") return null;
  if (input.checkedAt === null || input.now - input.checkedAt >= SIX_HOURS) return "check";
  return null;
}

/**
 * What quitting does: with a downloaded update, install it on the way out (stopping the
 * runner first, so the installer can replace files it uses); otherwise just quit and leave
 * the runner running, as `codeden` does.
 */
export function quitAction(phase: DesktopUpdatePhase): "install" | "quit" {
  return phase === "downloaded" ? "install" : "quit";
}
