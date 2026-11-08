import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEEP_LINK_SCHEME } from "@codeden/contracts";

/** What the app was started with. */
export interface LaunchArgs {
  /** `--home <dir>`, else `CODEDEN_HOME`, else `~/.codeden` (shared with `npx codeden`). */
  home: string;
  /** `--port <n>`: port for a server the app starts (default 4317, then any free port). */
  port: number | null;
  /** `--hidden`: start in the tray without showing the window (open at login). */
  hidden: boolean;
  /** `--fake`: load the scripted Fake provider (development and tests). */
  fake: boolean;
  /** A `codeden://` link passed on the command line (Windows and Linux). */
  deepLink: string | null;
}

export const DEFAULT_PORT = 4317;

/**
 * Parse the app's command line. Chromium and Electron switches (`--inspect`, `--no-sandbox`,
 * the app path in development) are ignored. Works on a second instance's argv too.
 */
export function parseLaunchArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): LaunchArgs {
  let explicitHome: string | null = null;
  let port: number | null = null;
  let hidden = false;
  let fake = false;
  let deepLink: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const [flag, inline] = arg.startsWith("--") ? splitFlag(arg) : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === "--home") explicitHome = value() ?? null;
    else if (flag === "--port") {
      const n = Number(value());
      port = Number.isInteger(n) && n >= 0 && n <= 65535 ? n : null;
    } else if (flag === "--hidden") hidden = true;
    else if (flag === "--fake") fake = true;
    else if (arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) deepLink = arg;
  }
  const chosen = explicitHome ?? env.CODEDEN_HOME;
  return {
    home: chosen ? resolve(chosen) : join(home, ".codeden"),
    port,
    hidden,
    fake: fake || env.CODEDEN_FAKE_PROVIDER === "1",
    deepLink,
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  const eq = arg.indexOf("=");
  return eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
}
