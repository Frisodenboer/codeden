import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  CODEDEN_VERSION,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCommand,
  RunnerToServerMessage,
} from "@codeden/contracts";
import WebSocket from "ws";

const root = resolve(import.meta.dirname, "..");

/** The unpacked app electron-builder made for this OS (`pnpm desktop:build`). */
export function unpackedApp(): string {
  const candidates = {
    win32: [join(root, "release", "win-unpacked", "CodeDen.exe")],
    darwin: ["mac-arm64", "mac", "mac-universal"].map((d) =>
      join(root, "release", d, "CodeDen.app", "Contents", "MacOS", "CodeDen"),
    ),
    linux: [join(root, "release", "linux-unpacked", "codeden")],
  }[process.platform as "win32" | "darwin" | "linux"];
  const found = candidates?.find((c) => existsSync(c));
  if (!found) throw new Error("No unpacked app: run `pnpm desktop:build` first");
  return found;
}

/**
 * How to launch the app: the unpacked build, or (`CODEDEN_DESKTOP_DEV=1`) this checkout's
 * `dist/` on the workspace's Electron, after `pnpm --filter @codeden/web build` and
 * `pnpm --filter @codeden/desktop build`. The dev form skips packaging for quick local runs.
 */
export function appLaunch(args: string[]): { executablePath: string; args: string[] } {
  if (process.env.CODEDEN_DESKTOP_DEV === "1") {
    const electron = createRequire(import.meta.url)("electron") as unknown as string;
    return { executablePath: electron, args: [root, ...args] };
  }
  return { executablePath: unpackedApp(), args };
}

/** A small committed git repo to add as a project. */
export function makeRepo(dir: string): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "ignore" });
  git("config", "user.email", "e2e@codeden.test");
  git("config", "user.name", "CodeDen E2E");
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  git("add", ".");
  git("commit", "-q", "-m", "Initial commit");
  return dir;
}

/**
 * Send one command to the home's runner over its protocol, as a second, non-attached client
 * (the server stays attached): what an agent tool does through the server, minus the MCP hop.
 */
export function runnerCommand<T = Record<string, unknown>>(
  home: string,
  command: RunnerCommand,
  timeoutMs = 60_000,
): Promise<T> {
  const lock = JSON.parse(readFileSync(join(home, "runner", "runner.json"), "utf8")) as {
    port: number;
    token: string;
  };
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${lock.port}/runner`, {
      headers: { authorization: `Bearer ${lock.token}` },
    });
    const done = (error: Error | null, value?: T) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => undefined);
      ws.close();
      if (error) reject(error);
      else resolvePromise(value as T);
    };
    const timer = setTimeout(() => done(new Error(`${command.name} timed out`)), timeoutMs);
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          serverVersion: CODEDEN_VERSION,
        }),
      ),
    );
    ws.on("message", (data) => {
      const parsed = RunnerToServerMessage.safeParse(JSON.parse(String(data)));
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "welcome") ws.send(JSON.stringify({ type: "command", id: "c1", command }));
      else if (msg.type === "result" && msg.id === "c1") {
        if (msg.ok) done(null, msg.result as T);
        else done(new Error(`${command.name}: ${msg.error?.message ?? "failed"}`));
      }
    });
    ws.on("error", (e) => done(e));
  });
}
