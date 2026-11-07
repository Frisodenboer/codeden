#!/usr/bin/env node
/**
 * `codeden` entry (§16). Runs the launcher first: when `<home>/app/current.json` pins a newer
 * installed version, that version's CLI runs in this process instead. Then it records this
 * package's version for the bundle and loads the CLI proper (`main.ts`).
 *
 * Keep this file free of top-level `await` and of imports beyond `./launcher` and Node
 * built-ins: a newer version is loaded with `import()`, and the rest of the bundle must not
 * start loading before the decision is made. Every version keeps this contract.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  decideLaunch,
  homeFromArgs,
  installKind,
  LAUNCH_KEY,
  LAUNCHED_BY_ENV,
  type LaunchInfo,
  parseLaunchedBy,
  restartCommandFor,
  VERSION_KEY,
} from "./launcher";

type Globals = Record<string, unknown>;

/** Loaded by an older copy's launcher, which handles our load errors (and falls back). */
const nested = (globalThis as Globals)[LAUNCH_KEY] !== undefined;

function ownVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function run(): Promise<void> {
  const globals = globalThis as Globals;
  const args = process.argv.slice(2);
  const selfEntry = fileURLToPath(import.meta.url);
  const selfVersion = ownVersion();
  const home = homeFromArgs(args);
  let warning: string | null = null;

  if (!nested) {
    const kind = installKind(selfEntry, home);
    const inherited = parseLaunchedBy(process.env[LAUNCHED_BY_ENV], home);
    delete process.env[LAUNCHED_BY_ENV];
    const info: LaunchInfo = inherited ?? {
      binEntry: selfEntry,
      binVersion: selfVersion,
      kind,
      source: kind === "source" ? "source" : "packaged",
      restartCommand: restartCommandFor(kind, selfEntry),
      home,
      warning: null,
    };
    const decision = decideLaunch({ selfEntry, selfVersion, home });
    if (decision.kind === "switch") {
      globals[LAUNCH_KEY] = info;
      try {
        const mod = (await import(pathToFileURL(decision.entry).href)) as { started?: unknown };
        if (mod.started instanceof Promise) await mod.started;
        return;
      } catch (error) {
        // It failed before starting anything: run this copy and say why.
        const reason = error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error);
        warning = `CodeDen ${decision.version} failed to load (${reason}); running ${selfVersion} instead.`;
      }
    } else {
      warning = decision.warning;
    }
    globals[LAUNCH_KEY] = { ...info, warning };
    if (warning) console.error(`codeden: ${warning}`);
  }

  globals[VERSION_KEY] = selfVersion;
  if (args.includes("--version") || args.includes("-v")) {
    console.log(selfVersion);
    process.exit(0);
  }
  await import("./main");
}

/** Settles once this copy's CLI has loaded (an older launcher that switched here awaits it). */
export const started: Promise<void> = run();
started.catch((error: unknown) => {
  if (nested) return;
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
