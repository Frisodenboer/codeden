import { existsSync } from "node:fs";
import path from "node:path";
import { type ResolvedCommand, resolveExecutable } from "../../util/exec";

/**
 * How to run npm for on-demand installs. Prefers the npm that started us (`npm_execpath`,
 * set under `npx`), then the npm shipped next to this Node binary, then `npm` on PATH.
 * Running `node <npm-cli.js>` avoids spawning a Windows `.cmd` shim through a shell.
 */
export function resolveNpm(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand | undefined {
  const fromEnv = env.npm_execpath;
  if (fromEnv && path.basename(fromEnv) === "npm-cli.js" && existsSync(fromEnv)) {
    return { kind: "node-script", path: execPath, script: fromEnv };
  }
  const nodeDir = path.dirname(execPath);
  const bundled =
    platform === "win32"
      ? path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")
      : path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(bundled)) return { kind: "node-script", path: execPath, script: bundled };
  return resolveExecutable("npm");
}
