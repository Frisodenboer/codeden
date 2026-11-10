import { spawn } from "node:child_process";
import { app } from "electron";
import { WATCHDOG_SCRIPT } from "./watchdog-script";

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

/**
 * Start a separate process that ends this one after `ms` if it hasn't exited by then. Unlike a
 * timer in this process, it still works when the main thread is stuck in native shutdown code
 * (seen with the x64 build under Rosetta). `cancel` stops it (e.g. before installing an update).
 */
export function armQuitWatchdog(ms: number, log: (message: string) => void): { cancel(): void } {
  try {
    const child = spawn(
      process.execPath,
      ["-e", WATCHDOG_SCRIPT, String(process.pid), String(ms)],
      {
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    child.on("error", (error) => log(`app: quit watchdog: ${String(error)}`));
    child.stdin?.on("error", () => {});
    child.unref();
    return { cancel: () => child.stdin?.end() };
  } catch (error) {
    log(`app: quit watchdog: ${String(error)}`);
    return { cancel: () => {} };
  }
}
