import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { WATCHDOG_SCRIPT } from "../src/main/watchdog-script";

const children: ChildProcess[] = [];

/** A stand-in for an app stuck while quitting: it never exits by itself. */
function stuckApp(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(child);
  return child;
}

function watchdog(pid: number, ms: number): ChildProcess {
  const child = spawn(process.execPath, ["-e", WATCHDOG_SCRIPT, String(pid), String(ms)], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  children.push(child);
  return child;
}

const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

describe("the quit watchdog", () => {
  it("ends an app that is still running when its time is up", async () => {
    const app = stuckApp();
    const dog = watchdog(app.pid as number, 300);
    await Promise.all([exited(app), exited(dog)]);
    expect(app.signalCode ?? app.exitCode).not.toBeNull();
  }, 15_000);

  it("stands down without killing anything once the app's pipe closes", async () => {
    const app = stuckApp();
    const dog = watchdog(app.pid as number, 2_000);
    dog.stdin?.end(); // what happens when the app exits, or cancels it
    await exited(dog);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(app.exitCode).toBeNull();
    expect(app.signalCode).toBeNull();
  }, 15_000);
});
