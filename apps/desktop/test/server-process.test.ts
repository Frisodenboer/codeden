import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServerProcess } from "../src/main/server-process";

const STUCK = resolve(__dirname, "support/stuck-server.mjs");
const dirs: string[] = [];

function stuckServer(log: string[]): ServerProcess {
  const home = mkdtempSync(join(tmpdir(), "codeden-server-process-"));
  dirs.push(home);
  return new ServerProcess({
    entry: STUCK,
    home,
    port: 1,
    fake: true,
    logFile: join(home, "logs", "desktop-server.log"),
    onUpdateCommand: () => {},
    onUnexpectedExit: () => {},
    log: (m) => log.push(m),
  });
}

afterEach(() => {
  delete process.env.STUCK_SERVER_MODE;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ServerProcess.stop", () => {
  it("stops a server whose close never finishes", async () => {
    const log: string[] = [];
    const server = stuckServer(log);
    await server.start();
    const started = Date.now();
    await server.stop({ stopRunner: false, timeoutMs: 200, graceMs: 2_000 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(server.pid).toBeUndefined();
    expect(log).toContain("server: did not exit in time; stopping it");
  });

  it.skipIf(process.platform === "win32")(
    "kills a server that also ignores SIGTERM, instead of waiting for it forever",
    async () => {
      process.env.STUCK_SERVER_MODE = "ignore-term";
      const log: string[] = [];
      const server = stuckServer(log);
      await server.start();
      const started = Date.now();
      await server.stop({ stopRunner: false, timeoutMs: 200, graceMs: 300 });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(server.pid).toBeUndefined();
      expect(log).toContain("server: still running; killing it");
    },
  );
});
