import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { CommandError } from "../errors";

/** Installed Chromium-family browsers playwright-core can drive by `channel`. */
export type BrowserChannel = "msedge" | "chrome";

export interface LaunchOptions {
  /** Channels to try, in order. Default: Edge then Chrome on Windows, Chrome then Edge elsewhere. */
  channels?: BrowserChannel[];
  /** Use this Chromium executable instead of an installed channel. */
  executablePath?: string;
  /**
   * Fall back to Playwright's own Chromium when no installed Edge/Chrome launches, and
   * download it if missing. Only set this with the user's consent (§12.2).
   */
  allowDownloadedChromium?: boolean;
  /** Default true. */
  headless?: boolean;
  log?: (message: string) => void;
}

export interface LaunchedBrowser {
  browser: Browser;
  /** `msedge`, `chrome`, `executable` or `chromium` (downloaded). */
  channel: string;
  /** Browser-level CDP WebSocket endpoint on 127.0.0.1. */
  cdpUrl: string;
  cdpPort: number;
  /** Browser process id (for process-tree cleanup); null if it could not be determined. */
  pid: number | null;
}

const isWindows = process.platform === "win32";

/** Default channel order for this platform. */
export function defaultChannels(): BrowserChannel[] {
  return isWindows ? ["msedge", "chrome"] : ["chrome", "msedge"];
}

function knownPaths(channel: BrowserChannel): string[] {
  if (isWindows) {
    const roots = [
      process.env["PROGRAMFILES(X86)"],
      process.env.PROGRAMFILES,
      process.env.LOCALAPPDATA,
    ].filter((r): r is string => Boolean(r));
    const rel =
      channel === "msedge"
        ? join("Microsoft", "Edge", "Application", "msedge.exe")
        : join("Google", "Chrome", "Application", "chrome.exe");
    return roots.map((root) => join(root, rel));
  }
  if (process.platform === "darwin") {
    return channel === "msedge"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  return channel === "msedge"
    ? ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge"]
    : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
}

/** Installed channels found at their standard locations (cheap, synchronous). */
export function findInstalledChannels(): BrowserChannel[] {
  return defaultChannels().filter((channel) => knownPaths(channel).some((p) => existsSync(p)));
}

/** A free TCP port on 127.0.0.1 (released before returning; callers retry on a race). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function cdpEndpoint(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(3_000),
    });
    const body = (await response.json()) as { webSocketDebuggerUrl?: string };
    return body.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

async function browserPid(browser: Browser): Promise<number | null> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    const info = (await cdp.send("SystemInfo.getProcessInfo")) as {
      processInfo: { type: string; id: number }[];
    };
    await cdp.detach().catch(() => undefined);
    return info.processInfo.find((p) => p.type === "browser")?.id ?? null;
  } catch {
    return null;
  }
}

type Target = { channel?: BrowserChannel; executablePath?: string; label: string };

async function launchTarget(target: Target, headless: boolean): Promise<LaunchedBrowser> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort();
    const browser = await chromium.launch({
      ...(target.channel ? { channel: target.channel } : {}),
      ...(target.executablePath ? { executablePath: target.executablePath } : {}),
      headless,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: [
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    const cdpUrl = await cdpEndpoint(port);
    if (cdpUrl) {
      return {
        browser,
        channel: target.label,
        cdpUrl,
        cdpPort: port,
        pid: await browserPid(browser),
      };
    }
    // Port taken between probe and launch: try again on a new one.
    lastError = new Error(`CDP endpoint on port ${port} did not answer`);
    await browser.close().catch(() => undefined);
  }
  throw lastError;
}

/** Download Playwright's Chromium build with the bundled playwright-core CLI. */
export function installChromium(log?: (message: string) => void): Promise<void> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
  log?.("downloading Chromium (consented fallback)");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cli, "install", "chromium"],
      { windowsHide: true, timeout: 10 * 60_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

/**
 * Launch one Chromium for the runner (§12.2): the installed Edge or Chrome first, then
 * (only when allowed) Playwright's downloaded Chromium. Exposes a CDP endpoint on 127.0.0.1.
 */
export async function launchChromium(opts: LaunchOptions = {}): Promise<LaunchedBrowser> {
  const headless = opts.headless ?? true;
  const failures: string[] = [];
  const targets: Target[] = opts.executablePath
    ? [{ executablePath: opts.executablePath, label: "executable" }]
    : (opts.channels ?? defaultChannels()).map((channel) => ({ channel, label: channel }));

  for (const target of targets) {
    try {
      const launched = await launchTarget(target, headless);
      opts.log?.(
        `browser: launched ${launched.channel} (pid ${launched.pid}) at ${launched.cdpUrl}`,
      );
      return launched;
    } catch (error) {
      failures.push(`${target.label}: ${firstLine(error)}`);
    }
  }

  if (opts.allowDownloadedChromium) {
    if (!existsSync(chromium.executablePath())) await installChromium(opts.log);
    return launchTarget({ label: "chromium" }, headless);
  }
  throw new CommandError(
    "browser_unavailable",
    `No installed Edge or Chrome could be launched (${failures.join("; ")}). ` +
      "Install Microsoft Edge or Google Chrome, or allow downloading Chromium.",
  );
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}
