import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireInstallLock,
  ownNodeEnv,
  type ResolvedCommand,
  resolveNpm,
  runNpm,
} from "@codeden/providers";
import {
  appDir,
  installProblem,
  isVersionName,
  PACKAGE_NAME,
  packageRoot,
  versionDir,
} from "./app-dir";

export interface InstallAppOptions {
  home: string;
  version: string;
  /** npm registry to install from (`CODEDEN_UPDATE_REGISTRY`, tests only); npm's config otherwise. */
  registry?: string;
  onProgress?: (line: string) => void;
  /** Override npm (tests). */
  npm?: ResolvedCommand;
  /** npm timeout (default 10 minutes). */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Install `codeden@<version>` side by side into `<home>/app/<version>` (§16): npm installs into
 * a staging folder, the result is checked (package version, entry files, and the installed CLI
 * answering `--version`), then the folder is renamed into place. A lock file keeps the server
 * and `codeden update` from installing at the same time. Resolves immediately when the version
 * is already installed and valid. Never touches the running version's files.
 */
export async function installAppVersion(opts: InstallAppOptions): Promise<void> {
  const { home, version } = opts;
  if (!isVersionName(version)) throw new Error(`"${version}" is not a version`);
  const progress = opts.onProgress ?? (() => {});
  const final = versionDir(home, version);
  if (!installProblem(packageRoot(home, version), version)) return;
  mkdirSync(appDir(home), { recursive: true });
  const release = await acquireInstallLock(join(appDir(home), ".install.lock"), {
    onWait: () => progress("Waiting for another update to finish"),
  });
  const staging = join(appDir(home), `.staging-${version}-${process.pid}`);
  try {
    if (!installProblem(packageRoot(home, version), version)) return;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    writeFileSync(
      join(staging, "package.json"),
      `${JSON.stringify({ name: "codeden-app", private: true }, null, 2)}\n`,
    );
    const npm = opts.npm ?? resolveNpm();
    if (!npm) throw new Error("npm was not found; install Node.js with npm and try again");
    const spec = `${PACKAGE_NAME}@${version}`;
    progress(`Downloading ${spec}`);
    await runNpm(
      npm,
      [
        "install",
        spec,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "--prefix",
        staging,
        ...(opts.registry ? ["--registry", opts.registry] : []),
      ],
      {
        cwd: staging,
        timeoutMs: opts.timeoutMs ?? 600_000,
        onLine: progress,
        // Never let an `npm exec -g` / global config turn this into a global install.
        env: { npm_config_global: "false", npm_config_location: "project" },
      },
    );
    const stagedRoot = join(staging, "node_modules", PACKAGE_NAME);
    const problem = installProblem(stagedRoot, version);
    if (problem) throw new Error(`npm finished but ${spec} is incomplete: ${problem}`);
    progress("Checking the new version");
    const reported = await reportedVersion(join(stagedRoot, "dist", "cli.js"));
    if (reported !== version) {
      throw new Error(`the installed CLI reports "${reported}" instead of ${version}`);
    }
    rmSync(final, { recursive: true, force: true, maxRetries: 3 });
    await moveDir(staging, final);
    progress(`Installed ${spec}`);
  } finally {
    rmSync(staging, { recursive: true, force: true, maxRetries: 2 });
    release();
  }
}

/** Run `node <cli.js> --version` without the launcher switching versions. */
export function reportedVersion(entry: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [entry, "--version"],
      {
        env: ownNodeEnv({ ...process.env, CODEDEN_NO_SWITCH: "1" }),
        timeout: 60_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message)
            .trim()
            .split(/\r?\n/)[0];
          reject(new Error(`the installed CLI does not start: ${detail}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/** Rename a folder, retrying while Windows (antivirus, indexers) holds it; copy as a last resort. */
async function moveDir(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      await sleep(250);
    }
  }
  cpSync(from, to, { recursive: true });
  if (!existsSync(to)) throw new Error(`could not move the new version into ${to}`);
}
