import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Exec } from "../exec";

export interface BrowserFound {
  name: "Microsoft Edge" | "Google Chrome" | "Chromium";
  path: string;
}

export interface BrowserProbe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  exec: Exec;
}

/** Common install locations per platform, most preferred first. */
export function candidatePaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): BrowserFound[] {
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(
      (r): r is string => Boolean(r),
    );
    return roots.flatMap((root) => [
      {
        name: "Microsoft Edge" as const,
        path: join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      },
      {
        name: "Google Chrome" as const,
        path: join(root, "Google", "Chrome", "Application", "chrome.exe"),
      },
    ]);
  }
  if (platform === "darwin") {
    return [
      {
        name: "Google Chrome",
        path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        name: "Microsoft Edge",
        path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      },
      { name: "Chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
    ];
  }
  return [];
}

const LINUX_COMMANDS: Array<[string, BrowserFound["name"]]> = [
  ["google-chrome", "Google Chrome"],
  ["google-chrome-stable", "Google Chrome"],
  ["microsoft-edge", "Microsoft Edge"],
  ["microsoft-edge-stable", "Microsoft Edge"],
  ["chromium", "Chromium"],
  ["chromium-browser", "Chromium"],
];

/** Windows App Paths registry keys (installs outside the usual folders). */
async function fromRegistry(exec: Exec): Promise<BrowserFound | null> {
  const keys: Array<[string, BrowserFound["name"]]> = [
    ["msedge.exe", "Microsoft Edge"],
    ["chrome.exe", "Google Chrome"],
  ];
  for (const [exe, name] of keys) {
    for (const hive of ["HKLM", "HKCU"]) {
      const result = await exec(
        "reg",
        [
          "query",
          `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
          "/ve",
        ],
        { timeoutMs: 5_000 },
      );
      const m = /REG_SZ\s+(.+)$/m.exec(result.stdout);
      const path = m?.[1]?.trim().replace(/^"|"$/g, "");
      if (result.code === 0 && path) return { name, path };
    }
  }
  return null;
}

/** Find an installed Edge or Chrome (§12.2: the runner drives the user's own browser). */
export async function detectBrowser(
  probe: Partial<BrowserProbe> & { exec: Exec },
): Promise<BrowserFound | null> {
  const platform = probe.platform ?? process.platform;
  const env = probe.env ?? process.env;
  const exists = probe.exists ?? existsSync;
  for (const candidate of candidatePaths(platform, env)) {
    if (exists(candidate.path)) return candidate;
  }
  if (platform === "win32") return fromRegistry(probe.exec);
  if (platform === "linux") {
    for (const [command, name] of LINUX_COMMANDS) {
      const result = await probe.exec("which", [command], { timeoutMs: 3_000 });
      const path = result.stdout.trim();
      if (result.code === 0 && path) return { name, path };
    }
  }
  return null;
}
