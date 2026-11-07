/**
 * A published-style CodeDen (the current build copied out of the repository) started through
 * its real CLI, plus a fake npm registry serving the same build relabelled as a newer version,
 * for the one-click update test (§16). Needs `apps/cli/dist` (`pnpm e2e` builds it).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CLI_ROOT,
  type FakeRegistry,
  packCli,
  startFakeRegistry,
} from "../../../cli/test/support/fake-registry";
import { installPublishedCopy } from "../../../cli/test/support/published-install";

export const NEXT_VERSION = "99.0.0-test";

export interface UpdateEnv {
  launchUrl: string;
  origin: string;
  token: string;
  home: string;
  /** The version the published-style copy reports before the update. */
  current: string;
  registry: FakeRegistry;
  /** Server output so far (both versions write to the same pipe). */
  log(): string;
  stop(): Promise<void>;
}

export async function startUpdateEnv(): Promise<UpdateEnv> {
  if (!existsSync(join(CLI_ROOT, "dist", "cli.js"))) {
    throw new Error("apps/cli/dist is missing: run `pnpm build` (pnpm e2e does)");
  }
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-e2e-update-")));
  const home = join(base, "home");
  const entry = installPublishedCopy(base, { linkDeps: true });
  const registry = await startFakeRegistry();
  registry.publish(NEXT_VERSION, packCli({ version: NEXT_VERSION, stripDependencies: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEDEN_HOME: "",
    CODEDEN_UPDATE_CHECK: "1",
    CODEDEN_UPDATE_REGISTRY: registry.url,
    CODEDEN_RELEASE_NOTES_URL: `${registry.url}/notes/v{version}`,
    CODEDEN_FAKE_PROVIDER: "1",
    CODEDEN_BUILTIN_PROVIDERS: "0",
    CODEDEN_GITHUB_SYNC: "0",
    CODEDEN_DEBUG: "1",
  };
  const current = spawnSync(process.execPath, [entry, "--version"], {
    env,
    encoding: "utf8",
  }).stdout.trim();
  let output = "";
  const child: ChildProcess = spawn(
    process.execPath,
    [entry, "--home", home, "--port", "0", "--no-open"],
    { env, stdio: ["ignore", "pipe", "pipe"], cwd: resolve(base) },
  );
  child.stdout?.on("data", (c: Buffer) => {
    output += c.toString();
  });
  child.stderr?.on("data", (c: Buffer) => {
    output += c.toString();
  });
  const launchUrl = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`CodeDen did not start:\n${output}`)), 90_000);
    const poll = setInterval(() => {
      const match = /Open: (\S+)/.exec(output);
      if (match) {
        clearInterval(poll);
        clearTimeout(timer);
        done(match[1] as string);
      }
    }, 100);
    child.once("exit", (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      fail(new Error(`CodeDen exited early (${code}):\n${output}`));
    });
  });
  const url = new URL(launchUrl);
  return {
    launchUrl,
    origin: url.origin,
    token: url.searchParams.get("token") ?? "",
    home,
    current,
    registry,
    log: () => output,
    async stop() {
      // The launcher of the copy we ran now starts the installed version; either stops it.
      spawnSync(process.execPath, [entry, "stop", "--home", home], { env, timeout: 30_000 });
      if (child.exitCode === null) {
        await new Promise<void>((done) => {
          const timer = setTimeout(() => {
            child.kill();
            done();
          }, 15_000);
          child.once("exit", () => {
            clearTimeout(timer);
            done();
          });
        });
      }
      await registry.close();
      try {
        rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch {
        // Windows may still hold a handle; the temp folder is cleaned later.
      }
    },
  };
}
