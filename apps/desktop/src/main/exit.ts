import { app } from "electron";

/** How long `app.exit` gets before the process ends itself. */
const EXIT_GRACE_MS = 5_000;

/**
 * Exit now. `app.exit` can stall when a quit is already under way (a slow quit that a failed
 * startup then tries to cut short), so if the process is still alive shortly after, it ends
 * itself: an app that was asked to quit must never stay running.
 */
export function forceExit(code: number): void {
  app.exit(code);
  setTimeout(() => process.kill(process.pid, "SIGKILL"), EXIT_GRACE_MS);
}
